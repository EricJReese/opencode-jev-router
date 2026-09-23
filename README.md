# Jev router for OpenCode

`JevAgent` is an OpenCode custom tool (via `JevRouterPlugin`) that picks a subagent and a model/thinking pair with Jev, then tells the primary agent to delegate through the built-in `task` tool. There is no dry-run mode, retry or automatic escalation. Pure routing logic lives in `router.ts`; OpenCode wiring lives in `plugin.ts`.

## Install

As an npm plugin (any project):

```json
{ "$schema": "https://opencode.ai/config.json", "plugin": ["opencode-jev-router"] }
```

Or as a local plugin — copy `plugin.ts` + `router.ts` into your project or global plugin dir:

```sh
mkdir -p .opencode/plugins
cp /path/to/opencode-jev-router/plugin.ts /path/to/opencode-jev-router/router.ts .opencode/plugins/jev-router/
# local plugins needing npm deps also need .opencode/package.json: { "dependencies": { "@opencode-ai/plugin": "^1.18.0" } }
```

Global equivalents: `~/.config/opencode/plugins/` and `~/.config/opencode/jev-router/config.json`.

Copy the example config into your own OpenCode config directory (project first, global fallback):

```sh
mkdir -p .opencode/jev-router
cp -n node_modules/opencode-jev-router/config.example.json .opencode/jev-router/config.json
```

Lookup order is `JEV_ROUTER_CONFIG` (explicit file) → `<project>/.opencode/jev-router/config.json` → `~/.config/opencode/jev-router/config.json`. Agent definition paths in `config.json` are relative to the config file's directory, e.g. `../agents/Explore.md` resolves to `.opencode/agents/Explore.md`. You must provide those subagent definitions yourself (`~/.config/opencode/agents/` globally or `.opencode/agents/` per project).

Call `JevAgent` to auto-select all three fields:

```json
{ "prompt": "Find the authentication entry points. Read only.", "description": "Find authentication entry points" }
```

Optional `agent`, `model` and `thinking` fields are hard constraints and must exactly match `config.json`. `max_turns` is a suggestion carried into the follow-up `task` call. Full explicit constraints bypass inference.

The tool returns the selection as text plus JSON and a next step: invoke the built-in `task` tool with `subagent_type="<agent>"`. OpenCode owns the subagent lifecycle after that.

## API keys — put them in the app, not in this package

Never put keys in `config.json` or commit them. The router resolves at runtime:

- Routing (Jev `systemone` call, `router.ts: jevApiKey/jevEndpoint/jevModel`): `JEV_API_KEY` wins, then `TYPESAFE_API_KEY` (backwards compat), then `AI_GATEWAY_API_KEY` when Jev is reached via Vercel AI Gateway. Endpoint defaults to `https://api.typesafe.ai/v1/systemone`; override with `JEV_BASE_URL` (e.g. your gateway URL) and model with `JEV_MODEL` (default `jev-latest`).
- Execution models (the `models[]` in `config.json`): these are OpenCode providers. For Vercel AI Gateway, run `/connect`, choose the gateway provider, paste `AI_GATEWAY_API_KEY` (stored in `~/.local/share/opencode/auth.json`), optionally pin `provider.vercel-ai-gateway.options.baseURL: https://ai-gateway.vercel.sh/v1` in `opencode.json`. Model IDs in `config.json` must match what that provider offers.

So a consuming app's `.env`/`.env.local` holds `JEV_API_KEY=` (or `AI_GATEWAY_API_KEY=`) plus `JEV_BASE_URL=` if proxied; this repo holds only code + `config.example.json`.

Note: unlike the old Pi version, there is no local model-registry filtering — keep `config.json` trimmed to models your gateway actually serves, or the follow-up `task` call will fail on an unknown model.

## Configuration

- `models` lists exact provider/model IDs, tiers, strengths/weaknesses, `thinking.supported` + `thinking.default`, routing hints, nullable `benchmarks.artificialAnalysis` (`null` = unknown). `routing.escalateTo` is advisory only.
- `agents` names existing OpenCode subagents. The plugin reads `.opencode/agents/*.md` (project, then `~/.config/opencode/agents/`) and refuses missing, disabled or shadowed definitions.
- `timeoutMs` (100–120000) bounds the Jev request only.
- No fallback by default. Add `"fallback": {"agent":"Explore","model":"...","thinking":"..."}` to allow one on Jev failure. Caller constraints still win; cancellation never falls back.

## Checks

```sh
npm install
node --test *.test.ts
```

Tests run on Node 22+ with native TypeScript support. HTTP is mocked; nothing hits paid Jev or launches a real subagent.
