# flight-ops-agent (Omnigent)

A custom [Omnigent](https://github.com/omnigent-ai/omnigent) agent that exposes this
repo's existing Lakebase feature-serving as agent **tools**, plus a live cost
policy and an OS-tool approval policy. Built on the public Omnigent OSS spec
(Apache-2.0, open source).

> Start with [FOLLOW_ALONG.md](../FOLLOW_ALONG.md) for the reliable, video-matching workflow: the deployed under-10ms agent plus cross-vendor review via Polly. The YAML configs here are the Omnigent agent-spec reference.

## Files

| File | Purpose |
|------|---------|
| `flight-ops-agent.yaml` | The custom agent. Documented-spec surface (`executor.harness/model/auth`, `type: function` tools, top-level `policies:`). |
| `tools/flight_tools.py` | Python callables referenced by the agent. Thin wrappers over `app/data.py` (the demo's own serving layer). |
| `tools/__init__.py`, `__init__.py` | Package markers so `flight_agent.tools.flight_tools` resolves. |
| `orchestrator/flight-ops-orchestrator.yaml` | Optional Polly-style cross-vendor orchestrator: a Claude analyst sub-agent (which owns the live tools) verified by a different-vendor (GPT) reviewer. Uses the example-surface `executor.type: omnigent` + `guardrails.policies`. |

## Run it

```bash
# from the repo root, so the `flight_agent.tools.flight_tools` package path resolves
omnigent run flight_agent/flight-ops-agent.yaml
# `omni run flight_agent/flight-ops-agent.yaml` also works - `omni` is the short alias.
```

Install Omnigent first if needed:

```bash
curl -fsSL https://raw.githubusercontent.com/omnigent-ai/omnigent/main/scripts/install_oss.sh | sh
# or: uv tool install omnigent   (requires Python 3.12+, uv, git, Node 22 LTS+)
omnigent setup   # configure model credentials (Databricks profile, etc.)
```

## What the agent does

The four `type: function` tools wrap `app/data.py`:

- `list_entities()` -> `data.meta()` - valid airports / carriers / years.
- `score_flight(origin, dest, carrier, year, mode)` -> `data.score_fast` (mode `fast`,
  one Lakebase UNION query, ~7ms in region) or `data.score` (mode `feast`,
  `get_online_features`, one read per view). Returns the feature breakdown plus
  measured `latency_ms`.
- `carrier_leaderboard(year)` -> `data.carriers_for_year()` - offline whole-fleet view.
- `airport_delay_trend(code)` -> `data.airport_trend()` - year-over-year series.

## Policies (from `docs/POLICIES.md`)

- `cost_budget` -> `omnigent.policies.builtins.cost.cost_budget` with
  `factory_params: { max_cost_usd, ask_thresholds_usd, expensive_models }`. ASKs
  at each soft threshold; at the hard limit it acts as a downgrade gate (DENY
  while on an expensive model - here `opus` - telling the user to switch with
  `/model`).
- `approve_os_tools` -> `omnigent.policies.builtins.safety.ask_on_os_tools`
  (direct callable, no params). Requires user approval before any
  `sys_os_read` / `sys_os_write` / `sys_os_edit` / `sys_os_shell` call. Pairs
  with the `os_env` block so any local file/shell access pauses for a human ASK.

## Two spec surfaces (important)

The live repo currently exposes two YAML surfaces. The agent uses the
**documented** one:

| Concern | Documented spec (`docs/`) - used by `flight-ops-agent.yaml` | Shipped examples (`examples/polly`, `examples/debby`) |
|---------|--------------------------------------------------|-------------------------------------------------------|
| version key | none documented (examples carry `spec_version: 1`) | `spec_version: 1` |
| executor | `harness:` / `model:` / `auth: {type, profile}` | `type: omnigent` + `config: {harness}` (+ `context_window`) |
| policies | top-level `policies:` with `handler` + `factory_params` | `guardrails.policies` with `function: {path, arguments}` |
| function tool | `type: function`, `callable:`, `parameters:` (JSON schema) | (examples use `tools.agents:` sub-agent list) |

The orchestrator (`orchestrator/flight-ops-orchestrator.yaml`) deliberately
shows BOTH: the runner-side `guardrails.policies` (example-surface,
`function: {path, arguments}`) on the orchestrator itself, and the documented
builtin `policies:` (`handler` + `factory_params`) on the worker sub-agent that
does the real Lakebase reads.

```bash
omnigent run flight_agent/orchestrator
```

Pick one surface per file; do not mix them. (`flight-ops-agent.yaml` keeps
`spec_version: 1` for parity with the shipped examples; the documented
single-file spec does not mention it, and the loader treats spec_version as a bundle marker, so the single-file agent omits it.)
