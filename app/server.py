"""FastAPI backend for the flight-delay dashboard.

JSON API over Feast/Lakebase (live per-flight scoring) + the offline feature
parquet (whole-fleet map / leaderboard / trends). Also serves the built React
app from app/web/dist, so `uvicorn app.server:app` is the single process -- the
shape a Databricks App expects.

Security hardening (for the Databricks Apps security review):
  * same-origin CSRF check on every state-changing request
  * conservative security response headers
  * a path-traversal-guarded static file handler for the SPA
  * no CORS at all -- the SPA is served same-origin, so no cross-origin access
    is granted (no wildcard, no credentials exposure)
  * interactive OpenAPI docs disabled in the deployed app

None of this touches the scoring hot path beyond one in-memory header compare,
so the Lakebase read stays single-digit milliseconds.

Run:  uvicorn server:app --reload --port 8000   (from app/)
"""
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import data

# OpenAPI / interactive docs are off in the deployed app so the schema is not
# exposed; set DEMO_ENABLE_DOCS=1 locally if you want the /docs page back.
_DOCS = os.environ.get("DEMO_ENABLE_DOCS") == "1"
app = FastAPI(
    title="Feast x Lakebase -- Flight Delays",
    docs_url="/docs" if _DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _DOCS else None,
)

# Static security headers stamped on every response. Deliberately minimal:
# `frame-ancestors` only governs who may iframe the page (clickjacking) and does
# NOT restrict the map's tiles / web workers / WebGL, so the dashboard is
# unaffected. We intentionally do NOT add a resource-restricting CSP that could
# break maplibre/deck.gl.
_SEC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "frame-ancestors 'self'",
}

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}

# Optional explicit allowlist of extra origin hosts (comma-separated, e.g.
# "https://my-app.example.com"). Empty by default, so the check is pure
# same-origin. This is an explicit allowlist, never a wildcard.
_EXTRA_ALLOWED = {
    (urlsplit(o.strip()).hostname or o.strip().split(":")[0])
    for o in os.environ.get("DEMO_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
}


def _same_origin(request: Request) -> bool:
    """CSRF defense: accept a state-changing request only when its Origin (or, as
    a fallback, Referer) host matches the host the app is actually served on.

    Browsers always attach Origin to cross-site POSTs and a page on another site
    cannot forge it, so this blocks cross-site request forgery without needing a
    token. Behind the Databricks Apps reverse proxy the public host arrives as
    X-Forwarded-Host, so a legitimate same-origin request matches against either
    that or the Host header (or an explicit DEMO_ALLOWED_ORIGINS entry).
    """
    if request.method in _SAFE_METHODS:
        return True
    source = request.headers.get("origin") or request.headers.get("referer")
    if not source:
        return False  # state-changing request with no Origin/Referer -> refuse
    src_host = urlsplit(source).hostname
    if not src_host:
        return False
    allowed = {
        h.split(":")[0]
        for h in (request.headers.get("x-forwarded-host"), request.headers.get("host"))
        if h
    }
    return src_host in allowed or src_host in _EXTRA_ALLOWED


@app.middleware("http")
async def harden_and_time(request: Request, call_next):
    """One pass: refuse cross-site state-changing requests (CSRF), measure the
    server's own processing time (X-Server-Ms, excludes client network), and
    stamp the security headers on the way out.
    """
    if not _same_origin(request):
        return JSONResponse(
            {"detail": "cross-origin request refused"},
            status_code=403,
            headers=_SEC_HEADERS,
        )
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Server-Ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
    for k, v in _SEC_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


@app.on_event("startup")
def _prewarm():
    """Warm the Lakebase connection at boot so the first real score is hot, not a
    cold ~1.5s. Matters most for a shared instance that many people hit at once.
    """
    try:
        data._store()                               # Feast store + warm pool + fast_score.warm()
        data.score_fast("ORD", "LAX", "AA", 2007)   # warm the default single-query path
        print("[startup] pre-warmed Lakebase connection", flush=True)
    except Exception as e:  # never let warm-up block the app from starting
        print(f"[startup] pre-warm skipped (non-fatal): {e}", flush=True)


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


# ---- serve the built React app (path-traversal guarded) --------------------
# No CORS middleware: the SPA is served from this same origin, so the browser
# never makes a cross-origin call and we grant none (no wildcard, no creds).
_DIST = Path(__file__).resolve().parent / "web" / "dist"
if _DIST.is_dir():
    # Hashed, immutable build assets are served straight from disk.
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # Resolve the requested path inside the build dir and refuse anything
        # that escapes it (path-traversal guard). Unknown client-side routes
        # fall back to the SPA entrypoint.
        target = (_DIST / full_path).resolve()
        if target.is_file() and target.is_relative_to(_DIST):
            return FileResponse(target)
        return FileResponse(_DIST / "index.html")
