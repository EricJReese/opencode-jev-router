import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Config, Input, ModelConfig, Selection } from './router.ts';

export type CreditBudgetStatus = { month: string; used: number; remaining: number; limit: number };
type Ledger = { month: string; used: number };

async function withLedgerLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try { handle = await open(lockPath, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the Jev credit ledger lock; no credits were reserved.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await action(); }
  finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}

export function creditLedgerPath(): string {
  return resolve(process.env.JEV_ROUTER_CREDIT_LEDGER?.trim() ||
    resolve(homedir(), '.config/opencode/jev-router/credit-usage.json'));
}

function currentMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function readLedger(path: string, month: string): Promise<Ledger> {
  try {
    const ledger = JSON.parse(await readFile(path, 'utf8')) as Ledger;
    if (!ledger || typeof ledger.month !== 'string' || !Number.isFinite(ledger.used) || ledger.used < 0) {
      throw new Error(`Invalid Jev credit ledger at ${path}. Correct or remove the file to continue.`);
    }
    return ledger.month === month ? ledger : { month, used: 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { month, used: 0 };
    throw error;
  }
}

async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function getCreditBudget(config: Config, path = creditLedgerPath(), date = new Date()): Promise<CreditBudgetStatus | undefined> {
  if (!config.creditBudget) return undefined;
  const month = currentMonth(date);
  const ledger = await readLedger(path, month);
  return {
    month, used: ledger.used,
    remaining: Math.max(0, config.creditBudget.monthlyLimit - ledger.used),
    limit: config.creditBudget.monthlyLimit,
  };
}

/** Reconcile the local ledger to the current total displayed in Copilot settings. */
export async function setCreditBudgetUsage(
  config: Config, used: number, path = creditLedgerPath(), date = new Date(),
): Promise<CreditBudgetStatus> {
  if (!config.creditBudget) throw new Error('Configure creditBudget in jev-router/config.json before using JevCreditBudget.');
  if (!Number.isFinite(used) || used < 0) throw new Error('Reported credit usage must be a nonnegative number.');
  const month = currentMonth(date);
  await withLedgerLock(path, () => writeLedger(path, { month, used }));
  return { month, used, remaining: Math.max(0, config.creditBudget.monthlyLimit - used), limit: config.creditBudget.monthlyLimit };
}

/** Remove GitHub models whose configured task estimate would exceed the remaining local budget. */
export function applyCreditBudget<T extends Config>(config: T, input: Input, status?: CreditBudgetStatus): T {
  if (!status || !config.creditBudget) return config;
  const cost = (model: ModelConfig) => model.estimatedCreditsPerTask ?? Number.POSITIVE_INFINITY;
  if (input.model) {
    const requested = config.models.find(model => model.id === input.model);
    if (requested?.id.startsWith('github-copilot/') && cost(requested) > status.remaining) {
      throw new Error(`Estimated GitHub AI-credit budget reached: ${status.used}/${status.limit} used, ${status.remaining} remaining; ${requested.id} is estimated at ${cost(requested)} credits per task.`);
    }
  }
  const models = config.models.filter(model =>
    !model.id.startsWith('github-copilot/') || cost(model) <= status.remaining);
  if (!models.length) {
    throw new Error(`Estimated GitHub AI-credit budget reached: ${status.used}/${status.limit} used; no configured model fits the remaining budget.`);
  }
  const fallback = config.fallback && models.some(model =>
    model.id === config.fallback?.model && model.thinking.supported.includes(config.fallback.thinking))
    ? config.fallback : undefined;
  return { ...config, models, ...(fallback ? { fallback } : { fallback: undefined }) } as T;
}

/** Persist a conservative estimate before launching a GitHub-model task. */
export async function reserveCreditEstimate(
  config: Config, selection: Selection, path = creditLedgerPath(), date = new Date(),
): Promise<CreditBudgetStatus | undefined> {
  if (!config.creditBudget || !selection.model.startsWith('github-copilot/')) return getCreditBudget(config, path, date);
  const estimate = config.models.find(model => model.id === selection.model)?.estimatedCreditsPerTask;
  if (estimate === undefined) throw new Error(`Missing estimatedCreditsPerTask for ${selection.model}.`);
  return withLedgerLock(path, async () => {
    const month = currentMonth(date);
    const previous = await readLedger(path, month);
    if (previous.used + estimate > config.creditBudget!.monthlyLimit) {
      throw new Error(`Estimated GitHub AI-credit budget would be exceeded: ${previous.used}/${config.creditBudget!.monthlyLimit} used, ${estimate} estimated for this task.`);
    }
    const next = { month, used: previous.used + estimate };
    await writeLedger(path, next);
    return {
      month, used: next.used,
      remaining: Math.max(0, config.creditBudget!.monthlyLimit - next.used),
      limit: config.creditBudget!.monthlyLimit,
    };
  });
}

export function modelCreditEstimate(config: Config, selection: Selection): number {
  return selection.model.startsWith('github-copilot/')
    ? config.models.find(model => model.id === selection.model)?.estimatedCreditsPerTask ?? Number.POSITIVE_INFINITY
    : 0;
}
