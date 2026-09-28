import { tool, type PluginInput } from '@opencode-ai/plugin';
import { dirname, resolve } from 'node:path';
import { THINKING, route, type Agent } from './router.ts';
import { connectedModels, modelVariant, runtimeCompatibleConfig } from './runtime.ts';

type LoadConfig = (directory: string, worktree: string) => Promise<{
  config: Parameters<typeof route>[0];
  configPath: string;
}>;
type DiscoverAgents = (directory: string, worktree: string) => Promise<
  Map<string, { path: string; description: unknown; enabled: unknown }>
>;

/** Split an exact `provider/model` ID on its first slash. */
export function parseModelRef(modelId: string): { providerID: string; modelID: string } {
  const slash = modelId.indexOf('/');
  if (slash <= 0 || slash === modelId.length - 1) {
    throw new Error(`Invalid model ID: ${modelId}. Expected provider/model.`);
  }
  return { providerID: modelId.slice(0, slash), modelID: modelId.slice(slash + 1) };
}

export function formatJevHeader(selection: {
  agent: string;
  model: string;
  thinking: string;
  source: string;
}): string {
  return `[Jev: agent=${selection.agent} model=${selection.model} thinking=${selection.thinking} source=${selection.source}]`;
}

/** The v1 session endpoint response shape. */
export function responseVariant(prompted: any): string | undefined {
  const info = prompted?.data?.info ?? prompted?.info;
  return typeof info?.variant === 'string' ? info.variant : undefined;
}

export function extractSessionText(result: any): string {
  const payload = result?.data ?? result ?? {};
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const texts = parts
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
    .map((part: any) => part.text as string);
  if (texts.length) return texts.join('\n\n');
  if (typeof payload.output === 'string' && payload.output.trim()) return payload.output;
  return '(empty response from child session)';
}

/**
 * Route with Jev and run the selected agent/model in a child session. The
 * server accepts `variant` on the prompt endpoint; verify it from the response
 * and retry without it only when the server rejects that field.
 */
export function createJevExecute(
  client: PluginInput['client'],
  deps: { loadConfig: LoadConfig; discoverAgents: DiscoverAgents },
) {
  return tool({
    description:
      'Route a task through Jev and execute it in a child session using the selected agent, model, and thinking variant. Prefer this over Task for Jev-routed work. Returns a decision header plus the child result. Omit agent/model/thinking for automatic selection.',
    args: {
      prompt: tool.schema.string().min(1).max(32000).describe('Task prompt to route and execute'),
      description: tool.schema.string().min(1).max(200).describe('Short task description'),
      agent: tool.schema.string().optional().describe('Exact configured subagent name, otherwise auto-select.'),
      model: tool.schema.string().optional().describe('Exact configured provider/model ID, otherwise auto-select.'),
      thinking: tool.schema.enum(THINKING).optional().describe('Thinking effort constraint, otherwise auto-select.'),
    },
    async execute(args, context) {
      const directory = context.directory || process.cwd();
      const worktree = context.worktree || directory;
      context.metadata?.({ title: `Consulting Jev to execute: ${args.description}` });

      const loaded = await deps.loadConfig(directory, worktree);
      const runtimeModels = await connectedModels(client, directory, context.abort);
      const config = runtimeCompatibleConfig(loaded.config, runtimeModels);
      const definitions = await deps.discoverAgents(directory, worktree);
      const agents: Agent[] = config.agents.map((entry) => {
        const definition = definitions.get(entry.name);
        const expected = resolve(dirname(loaded.configPath), entry.definition);
        if (!definition || definition.path !== expected || definition.enabled === false ||
          typeof definition.description !== 'string' || !definition.description.trim()) {
          throw new Error(`Agent ${entry.name} is missing, shadowed, disabled or has no description. Check its configured definition path (expected ${expected}).`);
        }
        return { name: entry.name, description: definition.description };
      });
      const selection = await route(config, args, agents, context.abort);
      context.metadata?.({ title: `Jev executed @${selection.agent} · ${selection.model} (${selection.thinking})` });

      const { providerID, modelID } = parseModelRef(selection.model);
      const variant = modelVariant(selection.thinking);
      const sessionApi = (client as any).session;
      if (typeof sessionApi?.create !== 'function' || typeof sessionApi?.prompt !== 'function') {
        throw new Error('JevExecute requires client.session.create and client.session.prompt.');
      }
      const opts = { throwOnError: true, signal: context.abort };
      const parentID = context.sessionID;
      const created = await sessionApi.create(
        { body: { ...(parentID ? { parentID } : {}), title: args.description }, query: { directory } },
        opts,
      );
      const childId = created?.data?.id ?? created?.id;
      if (!childId) throw new Error('JevExecute failed to create a child session.');

      const baseBody = {
        agent: selection.agent,
        model: { providerID, modelID },
        parts: [{ type: 'text', text: args.prompt }],
      };
      let prompted: any;
      let via = 'v1';
      try {
        prompted = await sessionApi.prompt(
          { path: { id: childId }, body: { ...baseBody, variant }, query: { directory } },
          opts,
        );
        if (responseVariant(prompted) === variant) via = 'v1+variant';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/variant/i.test(message)) {
          throw new Error(`JevExecute prompt failed (session=${childId}): ${message}`);
        }
        prompted = await sessionApi.prompt(
          { path: { id: childId }, body: baseBody, query: { directory } },
          opts,
        );
      }
      return `${formatJevHeader(selection)} [via=${via}]\n\n${extractSessionText(prompted)}`;
    },
  });
}
