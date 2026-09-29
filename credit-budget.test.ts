import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCreditBudget, getCreditBudget, reserveCreditEstimate, setCreditBudgetUsage } from './credit-budget.ts';
import { validateConfig, type Config } from './router.ts';

const config = (): Config => validateConfig({
  timeoutMs: 1000,
  creditBudget: { monthlyLimit: 100, preferEconomyWhenRemainingBelow: 25 },
  models: [
    { id: 'github-copilot/expensive', tier: 'expert', strengths: ['complex'], weaknesses: ['cost'],
      thinking: { supported: ['high'], default: 'high' }, routing: { preferWhen: ['complex'], avoidWhen: [] },
      estimatedCreditsPerTask: 30, benchmarks: { artificialAnalysis: { intelligenceIndex: null, costPerTask: null } } },
    { id: 'github-copilot/cheap', tier: 'economy', strengths: ['simple'], weaknesses: [],
      thinking: { supported: ['low'], default: 'low' }, routing: { preferWhen: ['simple'], avoidWhen: [] },
      estimatedCreditsPerTask: 10, benchmarks: { artificialAnalysis: { intelligenceIndex: null, costPerTask: null } } },
    { id: 'opencode/free', tier: 'free', strengths: ['general'], weaknesses: [],
      thinking: { supported: ['low'], default: 'low' }, routing: { preferWhen: ['free'], avoidWhen: [] },
      benchmarks: { artificialAnalysis: { intelligenceIndex: null, costPerTask: null } } },
  ],
  agents: [{ name: 'Explore', definition: 'Explore.md' }],
});

test('credit budget ledger reserves estimates, reconciles usage, and rolls over monthly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-credit-budget-'));
  const path = join(dir, 'usage.json');
  try {
    const c = config();
    const january = new Date('2026-01-15T12:00:00Z');
    assert.deepEqual(await getCreditBudget(c, path, january), {
      month: '2026-01', used: 0, remaining: 100, limit: 100,
    });
    await Promise.all(Array.from({ length: 5 }, () => reserveCreditEstimate(c,
      { agent: 'Explore', model: 'github-copilot/cheap', thinking: 'low' }, path, january)));
    assert.equal((await getCreditBudget(c, path, january))?.used, 50);
    assert.deepEqual(await setCreditBudgetUsage(c, 73, path, january), {
      month: '2026-01', used: 73, remaining: 27, limit: 100,
    });
    assert.equal((await getCreditBudget(c, path, new Date('2026-02-01T00:00:00Z')))?.used, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('credit budget blocks unaffordable models but leaves non-GitHub choices', () => {
  const c = config();
  const filtered = applyCreditBudget(c, { prompt: 'x', description: 'x' }, {
    month: '2026-01', used: 80, remaining: 20, limit: 100,
  });
  assert.deepEqual(filtered.models.map(model => model.id), ['github-copilot/cheap', 'opencode/free']);
  assert.throws(() => applyCreditBudget(c, {
    prompt: 'x', description: 'x', model: 'github-copilot/expensive',
  }, { month: '2026-01', used: 80, remaining: 20, limit: 100 }), /would be exceeded|estimated at 30/);
});

test('budget reservations are atomic and reject an estimate above the remaining allowance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-credit-budget-lock-'));
  const path = join(dir, 'usage.json');
  try {
    const c = config();
    const date = new Date('2026-01-15T12:00:00Z');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveCreditEstimate(c,
      { agent: 'Explore', model: 'github-copilot/cheap', thinking: 'low' }, path, date)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 10);
    await assert.rejects(reserveCreditEstimate(c,
      { agent: 'Explore', model: 'github-copilot/expensive', thinking: 'high' }, path, date), /budget would be exceeded/);
    assert.equal((await getCreditBudget(c, path, date))?.used, 100);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('credit budget configuration requires estimates for GitHub models', () => {
  const c = config();
  assert.throws(() => validateConfig({ ...c, models: c.models.map(({ estimatedCreditsPerTask: _estimate, ...model }) => model) }), /requires estimatedCreditsPerTask/);
});
