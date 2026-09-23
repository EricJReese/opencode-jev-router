// OpenCode plugin entry. Re-exported so `opencode.json: { "plugin": ["<package>"] }`
// finds the plugin, and so a local copy works under `.opencode/plugins/`.
export { JevRouterPlugin, configCandidates, parseAgentFile } from './plugin.ts';
export { route, validateConfig, validateInput, validateSelection, jevEndpoint, jevModel, jevApiKey, THINKING } from './router.ts';
export { JevRouterPlugin as default } from './plugin.ts';
