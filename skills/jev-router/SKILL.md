---
name: jev-router
description: Use the Jev router to select a configured OpenCode subagent, model, and thinking effort, then execute the selection authoritatively with JevExecute.
---

# Jev router

Use this skill when a task should be delegated to one of the configured subagents in `.opencode/agents/` and routed through Jev.

## Workflow

1. For routed work, call `JevExecute` with a concise task description and the complete delegation prompt. Leave `agent`, `model`, and `thinking` unset unless the user requests exact configured constraints. It routes with Jev, then starts a child session with the selected agent + model + thinking variant.
2. `JevExecute` always returns a `[Jev: agent=... model=... thinking=... source=...] [via=...]` header plus the child result. `via=v1+variant` means the server echoed the selected thinking variant; `via=v1` means the endpoint did not echo it, so agent + model are enforced but effort could not be verified. Report the header and result.
3. Use `JevAgent` only for a routing-only dry run. It does not execute a child session. If you manually follow it with the built-in `Task`, pass the selected agent name as `subagent_type` exactly; `Task` runs that agent's configured default model, so Jev's model and thinking picks are advisory on this path. Do not claim they were enforced.
4. If a Jev tool reports a routing/configuration/execution error, report it and do not silently substitute another agent or model.

The router only allows agents and models listed in `jev-router/config.json` (project first, then global). Selections are filtered against connected runtime models and thinking variants. Jev routing evaluates with `jev-latest` through the direct TypeSafe API (`POST https://api.typesafe.ai/v1/systemone`) using `TYPESAFE_API_KEY`. Never put API keys in router config or this skill. Execution remains uncapped (no steps/max_turns enforcement).
