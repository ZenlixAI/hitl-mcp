import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import dotenv from 'dotenv';
import YAML from 'js-yaml';
import { defaultConfig } from './defaults';
import { appConfigSchema, type AppConfig } from './types';

type Sources = {
  env?: Record<string, string>;
  dotenv?: Record<string, string>;
  yaml?: Record<string, unknown>;
};

type LoadConfigOptions = {
  env?: Record<string, string>;
  dotenv?: Record<string, string>;
  yaml?: Record<string, unknown>;
  dotenvPath?: string;
  yamlPath?: string;
  cwd?: string;
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
  config = deepMerge(config, mapEnv(dotenv));
  config = deepMerge(config, mapEnv(env));

  return appConfigSchema.parse(config);
}

function mapEnv(env: Record<string, string>): Partial<AppConfig> {
  const mapped: Partial<AppConfig> = {};

  if (env.HITL_SERVER_NAME || env.HITL_SERVER_VERSION || env.MCP_URL) {
    mapped.server = {
      ...(env.HITL_SERVER_NAME ? { name: env.HITL_SERVER_NAME } : {}),
      ...(env.HITL_SERVER_VERSION ? { version: env.HITL_SERVER_VERSION } : {}),
      ...(env.MCP_URL ? { baseUrl: env.MCP_URL } : {})
    } as AppConfig['server'];
  }

  if (env.HITL_HTTP_HOST || env.HITL_HTTP_PORT || env.HITL_HTTP_API_PREFIX || env.PORT) {
    mapped.http = {
      ...(env.HITL_HTTP_HOST ? { host: env.HITL_HTTP_HOST } : {}),
      ...((env.HITL_HTTP_PORT || env.PORT)
        ? { port: Number(env.HITL_HTTP_PORT || env.PORT) }
        : {}),
      ...(env.HITL_HTTP_API_PREFIX ? { apiPrefix: env.HITL_HTTP_API_PREFIX } : {})
    } as AppConfig['http'];
  }

  if (env.HITL_STORAGE) {
    mapped.storage = { kind: env.HITL_STORAGE === 'redis' ? 'redis' : 'memory' };
  }

  if (env.HITL_REDIS_URL || env.HITL_REDIS_PREFIX) {
    mapped.redis = {
      ...(env.HITL_REDIS_URL ? { url: env.HITL_REDIS_URL } : {}),
      ...(env.HITL_REDIS_PREFIX ? { keyPrefix: env.HITL_REDIS_PREFIX } : {})
    } as AppConfig['redis'];
  }

  if (env.HITL_TTL_SECONDS || env.HITL_ANSWERED_RETENTION_SECONDS) {
    mapped.ttl = {
      ...(env.HITL_TTL_SECONDS ? { defaultSeconds: Number(env.HITL_TTL_SECONDS) } : {}),
      ...(env.HITL_ANSWERED_RETENTION_SECONDS
        ? { answeredRetentionSeconds: Number(env.HITL_ANSWERED_RETENTION_SECONDS) }
        : {})
    } as AppConfig['ttl'];
  }

  if (env.HITL_PENDING_MAX_WAIT_SECONDS || env.HITL_WAIT_MODE) {
    mapped.pending = {
      ...(env.HITL_PENDING_MAX_WAIT_SECONDS ? { maxWaitSeconds: Number(env.HITL_PENDING_MAX_WAIT_SECONDS) } : {}),
      ...(env.HITL_WAIT_MODE ? { waitMode: env.HITL_WAIT_MODE as AppConfig['pending']['waitMode'] } : {})
    } as AppConfig['pending'];
  }

  if (env.HITL_AGENT_SESSION_HEADER || env.HITL_CREATE_CONFLICT_POLICY) {
    mapped.agentIdentity = {
      ...(env.HITL_AGENT_SESSION_HEADER
        ? { sessionHeader: env.HITL_AGENT_SESSION_HEADER }
        : {}),
      ...(env.HITL_CREATE_CONFLICT_POLICY
        ? { createConflictPolicy: env.HITL_CREATE_CONFLICT_POLICY as AppConfig['agentIdentity']['createConflictPolicy'] }
        : {})
    } as AppConfig['agentIdentity'];
  }

  if (env.HITL_LOG_LEVEL || env.HITL_ENABLE_METRICS) {
    mapped.observability = {
      ...(env.HITL_LOG_LEVEL
        ? { logLevel: (env.HITL_LOG_LEVEL as AppConfig['observability']['logLevel']) }
        : {}),
      ...(env.HITL_ENABLE_METRICS
        ? { enableMetrics: env.HITL_ENABLE_METRICS === 'true' }
        : {})
    } as AppConfig['observability'];
  }

  return mapped;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const cwd = options.cwd ?? process.cwd();
  const dotenvPath = options.dotenvPath ?? resolvePath(cwd, '.env');
  const yamlPath = options.yamlPath ?? resolvePath(cwd, 'config/hitl-mcp.yaml');

  const dotenvVars =
    options.dotenv ??
    (existsSync(dotenvPath)
      ? (dotenv.parse(readFileSync(dotenvPath, 'utf8')) as Record<string, string>)
      : {});

  const yamlConfig =
    options.yaml ??
    (existsSync(yamlPath)
      ? ((YAML.load(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>) ?? {})
      : {});

  return resolveConfig({
    yaml: yamlConfig,
    dotenv: dotenvVars,
    env: options.env ?? (process.env as Record<string, string>)
  });
}
