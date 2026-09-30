import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './router.ts';
import { parseAgentFile } from './plugin.ts';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.js', import.meta.url));

test('package entry exposes only one loadable plugin', async () => {
  const entry = await import('./index.ts');
  assert.deepEqual(Object.keys(entry), ['default']);
  const hooks = await entry.default({ client: {} } as any);
  assert.deepEqual(Object.keys(hooks.tool!), ['JevAgent', 'JevExecute', 'JevCreditBudget']);
});

test('init creates usable agent paths and preserves customized files on repeat runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-init-'));
  try {
    await run(process.execPath, [cli, 'init'], { cwd: directory });
    const configPath = join(directory, '.opencode/jev-router/config.json');
    const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')));
    for (const agent of config.agents) {
      const path = join(directory, '.opencode/jev-router', agent.definition);
      const definition = await readFile(path, 'utf8');
      assert.ok(parseAgentFile(definition).description);
      assert.match(definition, /mode: subagent/);
    }
    const skillPath = join(directory, '.opencode/skills/jev-router/SKILL.md');
    assert.match(await readFile(skillPath, 'utf8'), /JevExecute/);
    config.agents = [config.agents[0]];
    const customConfig = JSON.stringify(config);
    await writeFile(configPath, customConfig);
    const agentPath = join(directory, '.opencode/agents/Explore.md');
    await writeFile(agentPath, 'Custom agent');
    await writeFile(skillPath, 'Custom skill');
    const { stdout } = await run(process.execPath, [cli, 'init'], { cwd: directory });
    assert.match(stdout, /Kept existing/);
    assert.equal(await readFile(configPath, 'utf8'), customConfig);
    assert.equal(await readFile(agentPath, 'utf8'), 'Custom agent');
    assert.equal(await readFile(skillPath, 'utf8'), 'Custom skill');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
