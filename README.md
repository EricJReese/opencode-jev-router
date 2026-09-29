# Jev router for OpenCode

`JevRouterPlugin` provides three tools: `JevAgent` picks a subagent and model/thinking pair with Jev and returns a routing-only decision; `JevExecute` routes and executes in a child session with Jev's selected agent, model, and thinking variant; `JevCreditBudget` shows or reconciles the local monthly credit estimate. `JevExecute` coexists with OpenCode's built-in `task` tool and returns a decision/authority header plus the child result. Pure routing logic lives in `router.ts`; OpenCode wiring lives in `plugin.ts`; child-session execution lives in `execute.ts`.

## Install

As an npm plugin (any project):

```json
{ "$schema": "https://opencode.ai/config.json", "plugin": ["opencode-jev-router"] }
```

Or as a local plugin — copy `plugin.ts` + `router.ts` + `runtime.ts` into your project or global plugin dir:

```sh
mkdir -p .opencode/plugins
cp /path/to/opencode-jev-router/plugin.ts /path/to/opencode-jev-router/router.ts /path/to/opencode-jev-router/runtime.ts /path/to/opencode-jev-router/execute.ts /path/to/opencode-jev-router/credit-budget.ts .opencode/plugins/jev-router/
# local plugins needing npm deps also need .opencode/package.json: { "dependencies": { "@opencode-ai/plugin": "^1.18.0" } }
```

Optional but recommended: copy the routing skill alongside it:

```sh
mkdir -p .opencode/skills
cp -r /path/to/opencode-jev-router/skills/jev-router .opencode/skills/
```

Global equivalents: `~/.config/opencode/plugins/` and `~/.config/opencode/jev-router/config.json`.

Copy the example config into your own OpenCode config directory (project first, global fallback):

```sh
mkdir -p .opencode/jev-router
cp -n node_modules/opencode-jev-router/config.example.json .opencode/jev-router/config.json
```

Lookup order is `JEV_ROUTER_CONFIG` (explicit file) → `<project>/.opencode/jev-router/config.json` → `~/.config/opencode/jev-router/config.json`. Agent definition paths in `config.json` are relative to the config file's directory, e.g. `../agents/Explore.md` resolves to `.opencode/agents/Explore.md`. You must provide those subagent definitions yourself (`~/.config/opencode/agents/` globally or `.opencode/agents/` per project).

Call `JevExecute` to auto-select and execute all three fields:

```json
{ "prompt": "Find the authentication entry points. Read only.", "description": "Find authentication entry points" }
```

Optional `agent`, `model` and `thinking` fields are hard constraints and must exactly match `config.json`. Full explicit constraints bypass inference. Execution is uncapped.

`JevExecute` creates a child session using the selected agent and model, and sends the selected thinking variant (Jev `off` maps to OpenCode `none`). Its header includes `[via=v1+variant]` when the server echoes the selected variant; `[via=v1]` means variant enforcement could not be verified. `JevAgent` remains available for dry runs; if you use its result with built-in `task`, that tool runs the subagent's configured default model, so model and effort remain advisory.

Before routing, the tool intersects your configured catalog with the models the running OpenCode instance actually serves (`runtime.ts`). Selections can therefore never name a disconnected provider or an unsupported thinking level; an empty intersection fails fast with a diagnostic instead of failing later inside `task`.

`JevExecute` is uncapped by default; the child session may use tools until the model completes.

## API keys — put them in the app, not in this package

Never put keys in `config.json` or commit them. The router resolves at runtime:

- Routing (Jev `systemone` call, `router.ts: jevApiKey`): `TYPESAFE_API_KEY`. Endpoint is `https://api.typesafe.ai/v1/systemone` and the model is `jev-latest` (constants `JEV_API_URL`/`JEV_MODEL` in `router.ts`).
- Execution models (the `models[]` in `config.json`): these are OpenCode providers. Model IDs in `config.json` must match what the connected providers offer (see `runtime.ts`: the tool intersects the configured catalog with the running instance's connected models before routing).

So a consuming app's `.env`/`.env.local` holds `TYPESAFE_API_KEY=`; this repo holds only code + `config.example.json`.

Note: unlike the old Pi version, there is no local model-registry filtering — the runtime compatibility filter uses the connected models exposed by OpenCode before offering Jev its choices.

## Configuration

- `models` lists exact provider/model IDs, tiers, strengths/weaknesses, `thinking.supported` + `thinking.default`, routing hints, nullable `benchmarks.artificialAnalysis` (`null` = unknown). `routing.escalateTo` is advisory only. At runtime the list is filtered to connected providers and advertised thinking variants, so keep it as the full preference set rather than trimming it per machine.
- `agents` names existing OpenCode subagents. The plugin reads `.opencode/agents/*.md` (project, then `~/.config/opencode/agents/`) and refuses missing, disabled or shadowed definitions.
- `timeoutMs` (100–120000) bounds the Jev request only.
- No fallback by default. Add `"fallback": {"agent":"Explore","model":"...","thinking":"..."}` to allow one on Jev failure. Caller constraints still win; cancellation never falls back.

### Estimated GitHub AI-credit budget

Credit tracking is local and opt-in. It does not call GitHub and does not need a GitHub token. To enable a 24,000-credit monthly target, add a `creditBudget` object and an empirically calibrated `estimatedCreditsPerTask` for each `github-copilot/*` model in your config:

Add `"creditBudget": {"monthlyLimit": 24000, "preferEconomyWhenRemainingBelow": 6000}` to your config, and add `"estimatedCreditsPerTask": <your measured average>` to every `github-copilot/*` model. Do not use a guessed value. When budget tracking is enabled, each estimate must be a positive number; it is a flat estimate per launched task, not a verified GitHub rate. Compare estimates with Copilot settings and tune them. The router reserves the configured estimate before prompting the child session, excludes GitHub models whose estimate would exceed the remaining allowance, and rejects an explicitly constrained GitHub model if it cannot fit. Non-GitHub choices remain available. `JevAgent` only recommends and does not reserve credits; use `JevExecute` for ledgered execution.

The local ledger defaults to `~/.config/opencode/jev-router/credit-usage.json` and resets by UTC calendar month. Set `JEV_ROUTER_CREDIT_LEDGER` to use a different ledger file. Run `JevCreditBudget` to inspect it; call `JevCreditBudget` with `reportedUsage` set to the current month-to-date number shown in Copilot settings to reconcile estimates. This replaces that month's local estimate. Activity outside Jev is not automatically included, so reconcile periodically. The ceiling is enforced against the local estimate, not GitHub's authoritative total.

## Checks

```sh
npm install
node --test *.test.ts
```

Tests run on Node 22+ with native TypeScript support. HTTP is mocked; nothing hits paid Jev or launches a real subagent.
