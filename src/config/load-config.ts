import { defaultConfig } from './defaults';
import { appConfigSchema, type AppConfig } from './types';

type Sources = {
  env?: Record<string, string>;
  dotenv?: Record<string, string>;
  yaml?: Record<string, unknown>;
};

function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const merged: Record<string, any> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge((merged[key] ?? {}) as Record<string, any>, value as Record<string, any>);
    } else {
      merged[key] = value;
    }
  }

  return merged as T;
}

export async function resolveConfig(sources: Sources = {}): Promise<AppConfig> {
  const yaml = sources.yaml ?? {};
  const dotenv = sources.dotenv ?? {};
  const env = sources.env ?? (process.env as Record<string, string>);

  let config = deepMerge(defaultConfig, yaml as Partial<AppConfig>);

  if (dotenv.HITL_HTTP_PORT) {
    config = deepMerge(config, { http: { port: Number(dotenv.HITL_HTTP_PORT) } } as Partial<AppConfig>);
  }

  if (env.HITL_HTTP_PORT) {
    config = deepMerge(config, { http: { port: Number(env.HITL_HTTP_PORT) } } as Partial<AppConfig>);
  }

  return appConfigSchema.parse(config);
}
