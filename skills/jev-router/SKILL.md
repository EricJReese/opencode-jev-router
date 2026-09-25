---
name: jev-router
description: Use the Jev router to select a configured OpenCode subagent, model, and thinking effort for a task, then run the selection with the built-in Task tool.
---

# Jev router

Use this skill when a task should be delegated to one of the configured subagents in `.opencode/agents/` and routed through Jev.

## Workflow

1. Call the `JevAgent` tool with a concise task description and the complete delegation prompt. Leave `agent`, `model`, and `thinking` unset unless the user requests an exact configured choice.
2. The tool returns Jev's routing decision (`agent`, `model`, `thinking`, source). Selections are pre-filtered to models and thinking levels the running OpenCode instance actually serves, so the decision cannot name an unavailable model.
3. Execute the decision with the built-in `Task` tool. You MUST pass the returned agent name as `subagent_type` exactly as given — never substitute a different agent, and never skip the Task call after a successful routing. Start the Task prompt with the `[model: <id>]` prefix from the routing output so the intended model stays visible in the transcript. When reporting, state the `subagent_type` you used so the selection is auditable.
4. Jev's `model`/`thinking` values are recorded for transparency but are advisory: the `Task` tool accepts no model parameter and always runs the subagent's configured default model. Do not claim the model choice was enforced. Check the agent's configured default (`.opencode/agents/<agent>.md`, `model:` field): if it differs from Jev's pick, record both in your report and weigh the result accordingly on high-stakes tasks. To make a Jev-typical model stick, set a static `model:` in the agent's frontmatter (requires an OpenCode restart; applies to every invocation of that agent).
5. If `JevAgent` reports a routing/configuration error, report the error and do not silently substitute another agent or model.

The router only allows agents and models listed in `jev-router/config.json` (project first, then global). Jev evaluates through the `systemone` endpoint by default (`JEV_API_KEY`, `TYPESAFE_API_KEY` fallback); see README for the Vercel AI Gateway alternative. Never put API keys in router config or this skill.
