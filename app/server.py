"""FastAPI backend for the flight-delay dashboard.

JSON API over Feast/Lakebase (live per-flight scoring) + the offline feature
parquet (whole-fleet map / leaderboard / trends). Also serves the built React
app from app/web/dist, so `uvicorn app.server:app` is the single process — the
shape a Databricks App expects.

Run:  uvicorn server:app --reload --port 8000   (from app/)
"""
import os
import time
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import data

app = FastAPI(title="Feast × Lakebase — Flight Delays")


@app.middleware("http")
async def server_timing(request: Request, call_next):
    """Stamp each response with the server's own processing time (no client
    network), so the dashboard can report server-side latency for offline
    fetches the same way scoring reports the Lakebase read time.
    """
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Server-Ms"] = f"{(time.perf_counter() - t0) * 1000:.1f}"
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


# ---- serve the built React app (if present) --------------------------------
_DIST = os.path.join(os.path.dirname(__file__), "web", "dist")
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="web")
