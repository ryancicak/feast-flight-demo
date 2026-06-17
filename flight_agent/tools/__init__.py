# Makes `flight_agent.tools.flight_tools` importable as a package path, so
# flight-ops-agent.yaml can reference e.g.
# `callable: flight_agent.tools.flight_tools.score_flight`.
# Launch `omnigent run` from the repo root so the `omnigent` package is on sys.path.
