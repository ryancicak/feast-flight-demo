"""FastAPI backend for the flight-delay dashboard.

JSON API over Feast/Lakebase (live per-flight scoring) + the offline feature
parquet (whole-fleet map / leaderboard / trends). Also serves the built React
app from app/web/dist, so `uvicorn app.server:app` is the single process -- the
shape a Databricks App expects.

Security hardening (for the Databricks Apps security review):
  * same-origin CSRF check on every state-changing request (Origin-only)
  * conservative security response headers on success AND error responses
  * a path-traversal-guarded static file handler for the SPA
  * no CORS at all -- the SPA is served same-origin, so no cross-origin access
    is granted (no wildcard, no credentials exposure)
  * unhandled errors return a generic 500 (no stack traces / internals leaked)
  * interactive OpenAPI docs disabled in the deployed app

None of this touches the scoring hot path beyond one in-memory header compare,
so the Lakebase read stays single-digit milliseconds.

Run:  uvicorn server:app --reload --port 8000   (from app/)
"""
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import data

# Static security headers stamped on every response (success and error).
# Deliberately minimal: `frame-ancestors` only governs who may iframe the page
# (clickjacking) and does NOT restrict the map's tiles / web workers / WebGL, so
# the dashboard is unaffected. We intentionally do NOT add a resource-restricting
# CSP that could break maplibre/deck.gl.
_SEC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "frame-ancestors 'self'",
}

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def _parse_allowed(raw: str) -> set:
    """Parse DEMO_ALLOWED_ORIGINS into a set of lowercased hostnames. Rejects
    empty and wildcard ('*') entries so the allowlist can never be opened wide
    by a stray config value -- it is an explicit allowlist, never a wildcard.
    """
    out = set()
    for item in raw.split(","):
        item = item.strip()
        if not item or item == "*":
            continue
        host = (urlsplit(item).hostname or item.split(":")[0]).lower()
        if host and host != "*":
            out.add(host)
    return out


# Optional explicit allowlist of extra origin hosts, e.g.
# "https://my-app.example.com". Empty by default -> the check is pure
# same-origin against the (browser-set) Host header.
_EXTRA_ALLOWED = _parse_allowed(os.environ.get("DEMO_ALLOWED_ORIGINS", ""))


def _same_origin(request: Request) -> bool:
    """CSRF defense: accept a state-changing request only when its Origin header
    is present and its host matches the host the app is actually served on.

    Browsers always attach Origin to cross-site state-changing requests and a
    page on another site cannot forge it, so an Origin check blocks CSRF without
    a token. We match against the browser-set Host header -- a forbidden header
    that page scripts cannot forge -- plus any explicit DEMO_ALLOWED_ORIGINS
    entry. We do NOT trust X-Forwarded-Host (a cross-site fetch can set it) and
    we do NOT fall back to Referer (require Origin, fail closed otherwise). When
    a proxy rewrites Host to an internal value, set DEMO_ALLOWED_ORIGINS to the
    public app URL.
    """
    if request.method in _SAFE_METHODS:
        return True
    origin = request.headers.get("origin")
    if not origin:
        return False  # state-changing request with no Origin -> refuse
    src_host = (urlsplit(origin).hostname or "").lower()
    if not src_host:
        return False
    allowed = set(_EXTRA_ALLOWED)
    host = request.headers.get("host")
    if host:
        allowed.add(host.split(":")[0].lower())
    return src_host in allowed


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm the Lakebase connection at boot so the first real score is hot, not a
    cold ~1.5s. Matters most for a shared instance that many people hit at once.
    Warm-up failures never block startup, and we log only the error class so no
    host/credential detail lands in the app logs.
    """
    try:
        data._store()                               # Feast store + warm pool + fast_score.warm()
        data.score_fast("ORD", "LAX", "AA", 2007)   # warm the default single-query path
        print("[startup] pre-warmed Lakebase connection", flush=True)
    except Exception as e:  # never let warm-up block the app from starting
        print(f"[startup] pre-warm skipped (non-fatal): {type(e).__name__}", flush=True)
    yield


# OpenAPI / interactive docs are off in the deployed app so the schema is not
# exposed; set DEMO_ENABLE_DOCS=1 locally if you want the /docs page back.
_DOCS = os.environ.get("DEMO_ENABLE_DOCS") == "1"
app = FastAPI(
    title="Feast x Lakebase -- Flight Delays",
    docs_url="/docs" if _DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _DOCS else None,
    lifespan=lifespan,
)


@app.middleware("http")
async def harden_and_time(request: Request, call_next):
    """One pass: refuse cross-site state-changing requests (CSRF), measure the
    server's own processing time (X-Server-Ms, excludes client network), and
    stamp the security headers on the way out. Unhandled downstream errors are
    turned into a generic 500 -- still carrying the security headers and leaking
    no stack trace or internals.
    """
    if not _same_origin(request):
        return JSONResponse(
            {"detail": "cross-origin request refused"},
            status_code=403,
            headers=_SEC_HEADERS,
        )
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as e:
        print(f"[error] {request.method} {request.url.path}: {type(e).__name__}", flush=True)
        return JSONResponse({"detail": "internal error"}, status_code=500, headers=_SEC_HEADERS)
    response.headers["X-Server-Ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
    for k, v in _SEC_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


@app.get("/api/meta")
def meta():
    return data.meta()


@app.get("/api/map/{year}")
def map_year(year: int):
    return data.map_for_year(year)


@app.get("/api/carriers/{year}")
def carriers(year: int):
    return data.carriers_for_year(year)


@app.get("/api/airport/{code}/trend")
def trend(code: str):
    return data.airport_trend(code)


class ScoreReq(BaseModel):
    origin: str
    dest: str
    carrier: str
    year: int
    # "fast" reads every feature in one Lakebase query; "feast" uses Feast's
    # get_online_features (one read per view). Same result, different latency.
    mode: str = "fast"


@app.post("/api/score")
def score(req: ScoreReq):
    fn = data.score if req.mode == "feast" else data.score_fast
    return JSONResponse(fn(req.origin, req.dest, req.carrier, req.year))


class AgentReq(BaseModel):
    message: str


@app.post("/api/agent")
def agent_endpoint(req: AgentReq):
    """Tool-calling agent: a Databricks-hosted Claude model (Foundation Model API)
    reasons over the LIVE Lakebase feature store via score_flight / list_entities /
    carrier_leaderboard / airport_delay_trend. Returns {"answer", "reads"} where
    `reads` carries each score_flight call's measured Lakebase latency_ms, so the
    UI can always surface the read latency (in-region this is ~7ms)."""
    import agent  # lazy: isolate any agent/FM-API issue to THIS route, never app startup
    return JSONResponse(agent.run_agent(req.message))


# ---- serve the built React app (path-traversal guarded) --------------------
# No CORS middleware: the SPA is served from this same origin, so the browser
# never makes a cross-origin call and we grant none (no wildcard, no creds).
_DIST = (Path(__file__).resolve().parent / "web" / "dist").resolve()
if _DIST.is_dir():
    # Hashed, immutable build assets are served straight from disk.
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # Never serve the API namespace from the SPA fallback: unknown or
        # wrong-method /api/* paths get a real 404, not the index.html shell.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # Resolve the requested path inside the build dir and refuse anything
        # that escapes it (path-traversal guard). Malformed paths (e.g. NUL
        # bytes) degrade to the SPA entrypoint instead of erroring.
        try:
            target = (_DIST / full_path).resolve()
            if target.is_file() and target.is_relative_to(_DIST):
                return FileResponse(target)
        except (ValueError, OSError):
            pass
        # Unknown client-side routes fall back to the SPA entrypoint.
        return FileResponse(_DIST / "index.html")
