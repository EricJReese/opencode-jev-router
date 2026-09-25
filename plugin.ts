import { homedir } from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tool, type Plugin, type PluginInput } from '@opencode-ai/plugin';
import { THINKING, route, validateConfig, validateInput, type Agent } from './router.ts';
import { connectedModels, runtimeCompatibleConfig } from './runtime.ts';

const CONFIG_REL = '.opencode/jev-router/config.json';
const GLOBAL_CONFIG_REL = 'jev-router/config.json';

/** Minimal frontmatter reader for `.opencode/agents/*.md` (no Pi dependency). */
export function parseAgentFile(text: string): { name: string; description: unknown; enabled: unknown } {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const frontmatter: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) frontmatter[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return {
    name: frontmatter.name || '',
    description: frontmatter.description ?? '',
    enabled: frontmatter.enabled === undefined ? undefined : frontmatter.enabled !== 'false',
  };
}

/** Config lookup: explicit env override, project dirs, then the global config dir. */
export function configCandidates(directory: string, worktree: string): string[] {
  const override = process.env.JEV_ROUTER_CONFIG?.trim();
  const home = homedir();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [
    ...(override ? [resolve(override)] : []),
    resolve(directory, CONFIG_REL),
    resolve(worktree, CONFIG_REL),
    resolve(home, '.config/opencode', GLOBAL_CONFIG_REL),
  ]) {
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

async function loadConfig(directory: string, worktree: string) {
  let tried: string[] = [];
  for (const path of configCandidates(directory, worktree)) {
    tried.push(path);
    try {
      const text = await readFile(path, 'utf8');
      try {
        return { config: validateConfig(JSON.parse(text)), configPath: path };
      } catch (error) {
        throw new Error(`Invalid Jev router config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error(
    `Jev router config not found. Copy config.example.json to one of:\n${tried.map(p => `- ${p}`).join('\n')}`,
  );
}

/** Discover OpenCode subagent definitions (project first, then global). */
async function discoverAgents(directory: string, worktree: string): Promise<Map<string, { path: string; description: unknown; enabled: unknown }>> {
  const definitions = new Map<string, { path: string; description: unknown; enabled: unknown }>();
  const home = homedir();
  const seen = new Set<string>();
  for (const folder of [
    resolve(directory, '.opencode/agents'),
    resolve(worktree, '.opencode/agents'),
    resolve(home, '.config/opencode/agents'),
  ]) {
    if (seen.has(folder)) continue;
    seen.add(folder);
    let files: string[];
    try { files = await readdir(folder); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const path = resolve(folder, file);
      const parsed = parseAgentFile(await readFile(path, 'utf8'));
      const name = parsed.name.trim() || basename(file, '.md');
      // First definition wins (project shadows global), matching OpenCode precedence.
      if (!definitions.has(name)) definitions.set(name, { ...parsed, path });
    }
  }
  return definitions;
}

function createJevAgent(client: PluginInput['client']) {
  return tool({
  description:
    'Select an existing OpenCode subagent, model and thinking effort with Jev, then delegate via the task tool. Omit agent/model/thinking for automatic selection, or set exact configured values as hard constraints. No retries or automatic escalation.',
  args: {
    prompt: tool.schema.string().min(1).max(32000).describe('Task prompt to delegate'),
    description: tool.schema.string().min(1).max(200).describe('Short task description'),
    agent: tool.schema.string().optional().describe('Exact configured subagent name, otherwise auto-select.'),
    model: tool.schema.string().optional().describe('Exact configured provider/model ID, otherwise auto-select.'),
    thinking: tool.schema.enum(THINKING).optional().describe('Thinking effort constraint, otherwise auto-select.'),
    max_turns: tool.schema.number().int().min(1).max(100).optional().describe('Suggested turn limit for the delegated task'),
  },
  async execute(args, context) {
    const directory = context.directory || process.cwd();
    const worktree = context.worktree || directory;
    const loaded = await loadConfig(directory, worktree);
    const runtimeModels = await connectedModels(client, directory, context.abort);
    const config = runtimeCompatibleConfig(loaded.config, runtimeModels);
    const { configPath } = loaded;
    validateInput(config, args);
    const definitions = await discoverAgents(directory, worktree);
    const agents: Agent[] = config.agents.map(entry => {
      const definition = definitions.get(entry.name);
      const expected = resolve(dirname(configPath), entry.definition);
      if (!definition || definition.path !== expected || definition.enabled === false ||
        typeof definition.description !== 'string' || !definition.description.trim()) {
        throw new Error(`Agent ${entry.name} is missing, shadowed, disabled or has no description. Check its configured definition path (expected ${expected}).`);
      }
      return { name: entry.name, description: definition.description };
    });
    const selection = await route(config, args, agents, context.abort);
    const next = `Next step: invoke the task tool with subagent_type="${selection.agent}" and prompt starting with "[model: ${selection.model}] ${args.prompt}"` +
      (args.max_turns === undefined ? '' : ` (suggested turn limit: ${args.max_turns})`);
    return [
      `Selected ${selection.agent}: ${selection.model}, thinking ${selection.thinking}. Route: ${selection.source}.`,
      next,
      JSON.stringify({ ...selection, ...(args.max_turns === undefined ? {} : { max_turns: args.max_turns }) }),
    ].join('\n');
  },
  });
}

export const JevRouterPlugin: Plugin = async (ctx) => ({
  tool: { JevAgent: createJevAgent(ctx.client) },
});
