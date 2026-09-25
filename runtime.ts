import type { Thinking } from './router.ts';

/** OpenCode uses "none" for the no-reasoning effort variant. */
export function modelVariant(thinking: Thinking): string {
  return thinking === 'off' ? 'none' : thinking;
}

type RuntimeVariants = Record<string, unknown> | Array<{ id: string }>;

export type RuntimeModel = {
  id: string;
  providerID: string;
  enabled?: boolean;
  variants?: RuntimeVariants;
  capabilities?: { reasoning?: boolean };
};

function variantIds(variants?: RuntimeVariants): string[] {
  return Array.isArray(variants) ? variants.map(({ id }) => id) : Object.keys(variants ?? {});
}

/**
 * List models from connected providers only, using the host OpenCode
 * provider endpoint. Shape-agnostic: accepts the legacy `{ connected, all }`
 * response and normalizes entries to `providerID/id` pairs.
 */
export async function connectedModels(
  client: any,
  directory: string,
  signal?: AbortSignal,
): Promise<RuntimeModel[]> {
  const { data } = await client.provider.list({ directory }, { throwOnError: true, signal });
  const connected = new Set(data.connected);
  return data.all
    .filter((provider: { id: string }) => connected.has(provider.id))
    .flatMap((provider: { id: string; models: Record<string, Omit<RuntimeModel, 'providerID'>> }) =>
      Object.entries(provider.models).map(([id, model]) => ({ ...model, id, providerID: provider.id })),
    );
}

export type RuntimeCompatibleConfig = {
  models: Array<{ id: string; thinking: { supported: Thinking[]; default: Thinking } }>;
  fallback?: { model: string; thinking: Thinking; agent: string };
  agents: Array<{ name: string }>;
};

/**
 * Intersect the configured catalog with what the runtime actually serves.
 * Thinking levels without a matching runtime variant are dropped (except
 * `off` on non-reasoning models, which maps to `none`); models with no
 * surviving levels are removed. Throws a non-secret diagnostic when the
 * intersection is empty so misconfiguration surfaces instead of a late
 * failure inside the follow-up `task` call.
 */
export function runtimeCompatibleConfig<T extends RuntimeCompatibleConfig>(
  config: T,
  runtimeModels: RuntimeModel[],
): T {
  const models = config.models.flatMap((configured) => {
    const runtime = runtimeModels.find(
      (candidate) => `${candidate.providerID}/${candidate.id}` === configured.id,
    );
    if (!runtime || runtime.enabled === false) return [];
    const supported = configured.thinking.supported.filter((thinking) => {
      if (thinking === 'off' && !runtime.capabilities?.reasoning) return true;
      return variantIds(runtime.variants).includes(modelVariant(thinking));
    });
    if (!supported.length) return [];
    return [{
      ...configured,
      thinking: {
        supported,
        default: supported.includes(configured.thinking.default)
          ? configured.thinking.default
          : supported[0],
      },
    }];
  });
  if (!models.length) {
    const configured = config.models.map((model) => model.id).join(', ');
    const available = runtimeModels
      .filter((model) =>
        config.models.some((item) => item.id === `${model.providerID}/${model.id}`),
      )
      .map((model) =>
        `${model.providerID}/${model.id} (${model.enabled === false ? 'disabled' : variantIds(model.variants).join(', ') || 'no variants'})`,
      )
      .join(', ');
    throw new Error(
      `No configured Jev models match enabled OpenCode models and thinking variants. Configured: ${configured}. Matching runtime models: ${available || 'none'}.`,
    );
  }
  const fallback = config.fallback &&
      models.some((model) =>
        model.id === config.fallback?.model &&
        model.thinking.supported.includes(config.fallback.thinking),
      ) &&
      config.agents.some((agent) => agent.name === config.fallback?.agent)
    ? config.fallback
    : undefined;
  return { ...config, models, ...(fallback ? { fallback } : { fallback: undefined }) } as T;
}
