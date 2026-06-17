# Makes `flight_agent.tools` importable as a package, so the agent YAML can
# reference e.g. `callable: flight_agent.tools.flight_tools.score_flight`. Launch
# `omnigent run` from the repo ROOT so this folder resolves as the `omnigent`
# package on sys.path (the Omnigent CLI is invoked separately, not imported).
