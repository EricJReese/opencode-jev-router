import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectedModels, modelVariant, runtimeCompatibleConfig } from './runtime.ts';

const providerList = (connected: string[], all: Array<{ id: string; models: Record<string, unknown> }>) => ({
  async list() { return { data: { connected, all } }; },
});

const models = (id: string, supported: string[], def: string) => ({
  id, tier: 't', strengths: ['s'], weaknesses: ['w'],
  thinking: { supported, default: def },
  routing: { preferWhen: ['p'], avoidWhen: [] },
  benchmarks: { artificialAnalysis: { intelligenceIndex: null, costPerTask: null } },
});

test('connectedModels returns only models from connected providers', async () => {
  const client = { provider: providerList(['a'], [
    { id: 'a', models: { m: { id: 'm', variants: { high: {} }, capabilities: { reasoning: true } } } },
    { id: 'b', models: { n: { id: 'n', variants: { high: {} } } } },
  ]) };
  assert.deepEqual(await connectedModels(client, '/proj'), [
    { providerID: 'a', id: 'm', variants: { high: {} }, capabilities: { reasoning: true } },
  ]);
});

test('modelVariant maps Jev off to the OpenCode none variant', () => {
  assert.equal(modelVariant('off'), 'none');
  assert.equal(modelVariant('high'), 'high');
});

test('runtimeCompatibleConfig keeps only runtime-supported thinking levels', () => {
  const config = {
    models: [models('p/cheap', ['off', 'low', 'high'], 'high'), models('p/missing', ['low'], 'low')],
    agents: [{ name: 'architect' }],
    fallback: { agent: 'architect', model: 'p/cheap', thinking: 'high' as const },
  };
  const result = runtimeCompatibleConfig(config, [
    { providerID: 'p', id: 'cheap', variants: { low: {} }, capabilities: { reasoning: false } },
  ]);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0].thinking, { supported: ['off', 'low'], default: 'off' });
  assert.equal(result.fallback, undefined);
});

test('runtimeCompatibleConfig explains an empty intersection without leaking metadata', () => {
  assert.throws(() => runtimeCompatibleConfig(
    { models: [models('p/expected', ['high'], 'high')], agents: [{ name: 'architect' }] },
    [{ providerID: 'p', id: 'other', enabled: true, variants: [{ id: 'medium' }] }],
  ), (error: unknown) => {
    const message = (error as Error).message;
    assert.match(message, /p\/expected/);
    assert.doesNotMatch(message, /p\/other/);
    return true;
  });
});
