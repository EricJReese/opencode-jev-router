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

test('plugin exposes a JevAgent tool that routes fully-constrained calls without HTTP', async () => {
  const plugin = await JevRouterPlugin({} as any);
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

test('plugin fails before HTTP when config is missing or the agent is disabled', async () => {
  const plugin = await JevRouterPlugin({} as any);
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

test('parseAgentFile and configCandidates cover OpenCode lookup order', () => {
  assert.equal(parseAgentFile(agentMd).name, 'architect');
  assert.equal(parseAgentFile('---\nenabled: false\ndescription: x\n---\n').enabled, false);
  const [first] = configCandidates('/proj', '/proj');
  assert.ok(first.replace(/\\/g, '/').endsWith('.opencode/jev-router/config.json'));
});
