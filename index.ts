// OpenCode plugin entry. Re-exported so `opencode.json: { "plugin": ["<package>"] }`
// finds the plugin, and so a local copy works under `.opencode/plugins/`.
export { JevRouterPlugin, configCandidates, parseAgentFile } from './plugin.ts';
export { route, validateConfig, validateInput, validateSelection, JEV_API_URL, JEV_MODEL, jevApiKey, THINKING } from './router.ts';
export { connectedModels, modelVariant, runtimeCompatibleConfig, type RuntimeModel } from './runtime.ts';
export { createJevExecute, parseModelRef, formatJevHeader, responseVariant, extractSessionText } from './execute.ts';
export { JevRouterPlugin as default } from './plugin.ts';
