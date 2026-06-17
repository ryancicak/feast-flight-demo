"""In-app flight-ops agent: a tool-calling loop over the Databricks Foundation
Model API, wired to this app's real Lakebase feature reads (app/data.py).

Lives in app/ so the FastAPI server imports it by bare name (`import agent`),
like its siblings data / lakebase_app / fast_score. `run_agent()` returns
{"answer", "reads"} so the API response (and the React latency HUD) can ALWAYS
display the Lakebase online-read latency, regardless of the model's prose.

When this runs INSIDE the Databricks App it is co-located with Lakebase in
us-west-2, so score_flight's read is the real ~7ms. From a laptop you also pay
the WAN round-trip (~70ms). Same code either way.

Dual-mode auth (same split as lakebase_app):
  * Databricks App  -> WorkspaceClient()        == the app service principal
  * Local dev       -> WorkspaceClient(profile=$LAKEBASE_PROFILE | e2-demo-west)
"""
from __future__ import annotations

import json
import math
import os
import time

import requests

import data            # app/data.py -- the demo's serving layer (sibling import)
import lakebase_app    # for IS_APP detection (sibling import)

MODEL = os.environ.get("FLIGHT_AGENT_MODEL", "databricks-claude-opus-4-8")


def _client():
    from databricks.sdk import WorkspaceClient
    if lakebase_app.IS_APP:
        return WorkspaceClient()  # app service principal, in-region
    return WorkspaceClient(profile=os.environ.get("LAKEBASE_PROFILE", "e2-demo-west"))


_w = _client()
_ENDPOINT = f"{_w.config.host}/serving-endpoints/{MODEL}/invocations"

SYSTEM = (
    "You are flight-ops-agent, a flight delay risk analyst for a 20-year US "
    "flight-delay feature store (1988-2007). Your numbers come ONLY from the "
    "tools below, which read this demo's features from a Lakebase Postgres online "
    "store via Feast. Never invent delay numbers from prior knowledge.\n"
    "- Call list_entities first if unsure an airport/carrier/year is valid.\n"
    "- Use score_flight for a single flight. Always surface the returned "
    "latency_ms (the measured online read) when you report a score.\n"
    "- Ground every claim in the actual feature values returned (origin/carrier/"
    "route delay rates, weather counters, blended_delay_risk) and cite the year, "
    "since year is part of the entity key. Be concise and quantitative."
)

TOOLS = [
    {"type": "function", "function": {
        "name": "score_flight",
        "description": "Score one flight live from the Lakebase online store via Feast. "
                       "Returns the feature breakdown plus the measured online latency_ms.",
        "parameters": {"type": "object", "properties": {
            "origin": {"type": "string", "description": "Origin airport IATA code, e.g. ORD."},
            "dest": {"type": "string", "description": "Destination airport IATA code, e.g. LAX."},
            "carrier": {"type": "string", "description": "Carrier code, e.g. AA."},
            "year": {"type": "integer", "description": "Flight year 1988-2007 (part of the entity key)."},
            "mode": {"type": "string", "enum": ["fast", "feast"],
                     "description": "fast = one Lakebase query (default); feast = per-view."},
        }, "required": ["origin", "dest", "carrier", "year"]}}},
    {"type": "function", "function": {
        "name": "list_entities",
        "description": "List the airports, carriers, and years available in the online store.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "carrier_leaderboard",
        "description": "Carrier on-time leaderboard for a year, best-to-worst average delay.",
        "parameters": {"type": "object", "properties": {
            "year": {"type": "integer", "description": "Year to rank, 1988-2007."}},
            "required": ["year"]}}},
    {"type": "function", "function": {
        "name": "airport_delay_trend",
        "description": "Year-over-year delay trend for one airport.",
        "parameters": {"type": "object", "properties": {
            "code": {"type": "string", "description": "Airport code, e.g. ORD."}},
            "required": ["code"]}}},
]


def _jsonable(o):
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, float) and math.isnan(o):
        return None
    return o


def _exec_tool(name: str, args: dict):
    if name == "score_flight":
        mode = args.get("mode", "fast")
        fn = data.score if mode == "feast" else data.score_fast
        return fn(args["origin"], args["dest"], args["carrier"], int(args["year"]))
    if name == "list_entities":
        return data.meta()
    if name == "carrier_leaderboard":
        return data.carriers_for_year(int(args["year"]))
    if name == "airport_delay_trend":
        return data.airport_trend(args["code"])
    raise ValueError(f"unknown tool {name!r}")


def _call_model(messages: list) -> dict:
    body = {"messages": messages, "tools": TOOLS, "tool_choice": "auto", "max_tokens": 2048}
    headers = {**_w.config.authenticate(), "Content-Type": "application/json"}
    r = requests.post(_ENDPOINT, headers=headers, json=body, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"FM API {r.status_code}: {r.text[:500]}")
    return r.json()["choices"][0]["message"]


def run_agent(user_msg: str, max_iters: int = 6, verbose: bool = False) -> dict:
    """Tool-calling loop. Returns {"answer": str, "reads": [...]}.

    Every score_flight call records its measured Lakebase online-read latency in
    `reads` (captured in code, so the latency is always available to display).
    """
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": user_msg}]
    reads: list = []
    for _ in range(max_iters):
        msg = _call_model(messages)
        tool_calls = msg.get("tool_calls") or []
        messages.append({"role": "assistant",
                         "content": msg.get("content") or "",
                         **({"tool_calls": tool_calls} if tool_calls else {})})
        if not tool_calls:
            return {"answer": msg.get("content") or "", "reads": reads}
        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            t0 = time.perf_counter()
            try:
                result = _jsonable(_exec_tool(name, args))
                err = None
            except Exception as e:
                result, err = {"error": str(e)}, str(e)
            wall_ms = round((time.perf_counter() - t0) * 1000, 1)
            if name == "score_flight" and isinstance(result, dict) and not err:
                reads.append({
                    "tool": name,
                    "route": f'{args.get("carrier","?")} {args.get("origin","?")}'
                             f'->{args.get("dest","?")} {args.get("year","?")}',
                    "latency_ms": result.get("latency_ms", wall_ms),
                    "kind": "lakebase-online",
                })
            if verbose:
                shown = result.get("latency_ms", wall_ms) if isinstance(result, dict) else wall_ms
                print(f"  [tool] {name}({args}) -> {('ERROR ' + err) if err else str(shown) + 'ms'}")
            messages.append({"role": "tool", "tool_call_id": tc["id"],
                             "content": json.dumps(result)})
    return {"answer": "(stopped: reached max tool iterations)", "reads": reads}


def latency_banner(reads: list) -> str:
    """Prominent, always-on text display of the Lakebase online-read latency."""
    online = [r for r in reads if r.get("kind") == "lakebase-online"]
    if not online:
        return ""
    bar = "=" * 66
    lines = ["", bar]
    for r in online:
        lines.append(f"  LAKEBASE ONLINE READ  |  {r['route']}  |  {r['latency_ms']} ms")
    lines.append("  in-region: single-digit ms (co-located with Lakebase).")
    lines.append("  from a laptop you also pay the WAN round-trip to us-west-2.")
    lines.append(bar)
    return "\n".join(lines)
