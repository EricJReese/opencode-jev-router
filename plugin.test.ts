import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevRouterPlugin, parseAgentFile, configCandidates } from './plugin.ts';

const context = (directory: string) => ({
  directory, worktree: directory, sessionID: 's', messageID: 'm', agent: 'build',
});

async function project(files: { config: unknown; agentMd: string }) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-opencode-'));
  await mkdir(join(dir, '.opencode/jev-router'), { recursive: true });
  await mkdir(join(dir, '.opencode/agents'), { recursive: true });
  await writeFile(join(dir, '.opencode/jev-router/config.json'), JSON.stringify(files.config));
  await writeFile(join(dir, '.opencode/agents/architect.md'), files.agentMd);
  return dir;
}

const baseConfig = {
  timeoutMs: 1000,
  models: [{
    id: 'gateway/strong', tier: 'expert', strengths: ['reasoning'], weaknesses: ['cost'],
    thinking: { supported: ['high'], default: 'high' },
    routing: { preferWhen: ['task_is_complex'], avoidWhen: [] },
    benchmarks: { artificialAnalysis: { intelligenceIndex: null, costPerTask: null } },
  }],
  agents: [{ name: 'architect', definition: '../agents/architect.md' }],
};
const agentMd = '---\nname: architect\ndescription: Reviews boundaries\n---\nBody\n';

// Runtime catalog containing exactly the model the fixture config declares.
const client = { provider: { async list() { return { data: {
  connected: ['gateway'],
  all: [{ id: 'gateway', models: {
    strong: { id: 'strong', variants: { high: {} }, capabilities: { reasoning: true } },
  } }],
} }; } } };

test('plugin exposes a JevAgent tool that routes fully-constrained calls without HTTP', async () => {
  const plugin = await JevRouterPlugin({ client } as any);
  const toolDef = (plugin.tool as any).JevAgent;
  assert.ok(toolDef, 'JevAgent tool must be registered');

  const dir = await project({ config: baseConfig, agentMd });
  try {
    const out = await toolDef.execute(
      { prompt: 'Review the module boundaries.', description: 'Review module boundaries',
        agent: 'architect', model: 'gateway/strong', thinking: 'high', max_turns: 7 },
      context(dir),
    );
    assert.match(out, /architect/);
    assert.match(out, /gateway\/strong/);
    assert.match(out, /constraints/);
    assert.match(out, /task tool/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('JevExecute enforces agent, model and thinking variant in a child session', async () => {
  const calls: { create: any[]; prompt: any[] } = { create: [], prompt: [] };
  const routedClient = {
    provider: { async list() { return { data: {
      connected: ['gateway'],
      all: [{ id: 'gateway', models: {
        strong: { id: 'strong', variants: { high: {} }, capabilities: { reasoning: false } },
      } }],
    } }; } },
    session: {
      async create(options: any) {
        calls.create.push(options);
        return { data: { id: 'child-session' } };
      },
      async prompt(options: any) {
        calls.prompt.push(options);
        return { data: { info: { variant: 'high' }, parts: [{ type: 'text', text: 'Review complete.' }] } };
      },
    },
  };
  const plugin = await JevRouterPlugin({ client: routedClient } as any);
  const toolDef = (plugin.tool as any).JevExecute;
  assert.ok(toolDef, 'JevExecute tool must be registered');

  const dir = await project({ config: baseConfig, agentMd });
  try {
    const out = await toolDef.execute(
      { prompt: 'Review module boundaries.', description: 'Review boundaries',
        agent: 'architect', model: 'gateway/strong', thinking: 'high' },
      {
        ...context(dir), abort: new AbortController().signal,
        metadata() {}, ask: async () => {},
      },
    );
    assert.match(out, /\[Jev: agent=architect model=gateway\/strong thinking=high source=constraints\] \[via=v1\+variant\]/);
    assert.match(out, /Review complete\./);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].body.parentID, 's');
    assert.equal(calls.prompt.length, 1);
    assert.equal(calls.prompt[0].body.agent, 'architect');
    assert.deepEqual(calls.prompt[0].body.model, { providerID: 'gateway', modelID: 'strong' });
    assert.equal(calls.prompt[0].body.variant, 'high');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('JevExecute maps off to none and retries without variant when unsupported', async () => {
  const prompts: any[] = [];
  const routedClient = {
    provider: { async list() { return { data: {
      connected: ['gateway'],
      all: [{ id: 'gateway', models: {
        strong: { id: 'strong', variants: { high: {} }, capabilities: { reasoning: false } },
      } }],
    } }; } },
    session: {
      async create() { return { data: { id: 'child-session' } }; },
      async prompt(options: any) {
        prompts.push(options);
        if (prompts.length === 1) throw new Error('400: unsupported variant field');
        return { data: { info: {}, parts: [{ type: 'text', text: 'Fallback response.' }] } };
      },
    },
  };
  const offConfig = {
    ...baseConfig,
    models: [{ ...baseConfig.models[0], thinking: { supported: ['off'] as const, default: 'off' as const } }],
  };
  const plugin = await JevRouterPlugin({ client: routedClient } as any);
  const dir = await project({ config: offConfig, agentMd });
  try {
    const out = await (plugin.tool as any).JevExecute.execute(
      { prompt: 'Review.', description: 'Review', agent: 'architect', model: 'gateway/strong', thinking: 'off' },
      { ...context(dir), abort: new AbortController().signal, metadata() {}, ask: async () => {} },
    );
    assert.match(out, /\[via=v1\]/);
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].body.variant, 'none');
    assert.equal('variant' in prompts[1].body, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plugin fails before HTTP when config is missing or the agent is disabled', async () => {
  const plugin = await JevRouterPlugin({ client } as any);
  const toolDef = (plugin.tool as any).JevAgent;
  const dir = await mkdtemp(join(tmpdir(), 'jev-opencode-empty-'));
  try {
    await assert.rejects(
      toolDef.execute({ prompt: 'x', description: 'y' }, context(dir)),
      /config not found/,
    );
    const filled = await project({ config: baseConfig,
      agentMd: '---\nname: architect\nenabled: false\ndescription: Disabled\n---\n' });
    try {
      await assert.rejects(
        toolDef.execute({ prompt: 'Review.', description: 'Review',
          agent: 'architect', model: 'gateway/strong', thinking: 'high' }, context(filled)),
        /disabled|missing|shadowed/,
      );
    } finally {
      await rm(filled, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('plugin rejects configured models the runtime does not serve', async () => {
  const plugin = await JevRouterPlugin({ client } as any);
  const dir = await project({ config: baseConfig, agentMd });
  try {
    await assert.rejects(
      (plugin.tool as any).JevAgent.execute(
        { prompt: 'Review.', description: 'Review', agent: 'architect', model: 'gateway/missing', thinking: 'high' },
        context(dir),
      ),
      /Model override must exactly match/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('JevCreditBudget displays and reconciles local usage', async () => {
  const dir = await project({ config: {
    ...baseConfig,
    creditBudget: { monthlyLimit: 24000 },
  }, agentMd });
  const ledger = join(dir, 'credits.json');
  const previousLedger = process.env.JEV_ROUTER_CREDIT_LEDGER;
  process.env.JEV_ROUTER_CREDIT_LEDGER = ledger;
  try {
    const plugin = await JevRouterPlugin({ client } as any);
    const toolDef = (plugin.tool as any).JevCreditBudget;
    const run = (args: object) => toolDef.execute(args, context(dir));
    assert.match(await run({}), /0\/24000 used/);
    assert.match(await run({ reportedUsage: 3210 }), /3210\/24000 credits/);
    assert.match(await run({}), /3210\/24000 used/);
  } finally {
    if (previousLedger === undefined) delete process.env.JEV_ROUTER_CREDIT_LEDGER;
    else process.env.JEV_ROUTER_CREDIT_LEDGER = previousLedger;
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseAgentFile and configCandidates cover OpenCode lookup order', () => {
  assert.equal(parseAgentFile(agentMd).name, 'architect');
  assert.equal(parseAgentFile('---\nenabled: false\ndescription: x\n---\n').enabled, false);
  const [first] = configCandidates('/proj', '/proj');
  assert.ok(first.replace(/\\/g, '/').endsWith('.opencode/jev-router/config.json'));
});
