"""Local CLI for the in-app flight-ops agent.

Runs the EXACT same run_agent() the app serves at POST /api/agent (app/agent.py),
from your laptop, so you can iterate before/without deploying. Pre-warms Lakebase
so the displayed read is the warm number (~70ms laptop / ~7ms in-region), not the
one-time ~2s cold start.

    cd ~/Documents/feast-flight-demo
    export LAKEBASE_PROFILE=e2-demo-west
    .venv/bin/python flight_agent/agent_local.py "Score AA from ORD to LAX in 2007 and explain the risk."

This is a thin wrapper: all the agent logic (tools, model call, the loop, the
latency banner) lives in app/agent.py, so the CLI and the deployed app never drift.
"""
import os
import sys
import time

os.environ.setdefault("LAKEBASE_PROFILE", "e2-demo-west")
# app/ on sys.path so the app's flat-import modules (data, agent, ...) resolve.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

import data    # noqa: E402  -- app/data.py
import agent   # noqa: E402  -- app/agent.py (single source of truth)


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "Score AA from ORD to LAX in 2007 and explain the risk."
    print(f"Q: {q}\n", file=sys.stderr)
    # Pre-warm so the displayed read is the WARM number, not the cold start.
    print("warming Lakebase connection...", file=sys.stderr)
    try:
        _w0 = time.perf_counter()
        data.score_fast("ORD", "LAX", "AA", 2007)
        print(f"warmed in {round((time.perf_counter() - _w0) * 1000)}ms\n", file=sys.stderr)
    except Exception as _e:
        print(f"warm-up skipped: {_e}\n", file=sys.stderr)
    res = agent.run_agent(q, verbose=True)
    print(res["answer"])
    banner = agent.latency_banner(res["reads"])
    if banner:
        print(banner)
