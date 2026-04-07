import { MCPServer } from 'mcp-use/server';
import { loadConfig } from '../config/load-config';
import { HitlService } from '../core/hitl-service';
import { apiKeyAuth, resolveApiKeyPrincipal } from '../http/middleware/auth';
import { requestContextMiddleware } from '../http/middleware/request-context';
import { requestIdMiddleware } from '../http/middleware/request-id';
import { questionRoutes } from '../http/routes/questions';
import { ok } from '../http/response';
import { injectCallerScopeIntoMcpState } from '../mcp/caller-scope';
import { registerHitlTools } from '../mcp/register-tools';
import { Logger } from '../observability/logger';
import { HitlMetrics } from '../observability/metrics';
import type { HitlRepository } from '../storage/hitl-repository';
import { InMemoryHitlRepository } from '../storage/in-memory-repository';
import { createRedisClient } from '../storage/redis-client';
import { RedisHitlRepository } from '../storage/redis-hitl-repository';
import { Waiter } from '../state/waiter';

async function resolveRepository(params: {
  storageKind: 'memory' | 'redis';
  redisUrl: string;
  redisPrefix: string;
  ttlSeconds: number;
}): Promise<HitlRepository> {
  if (params.storageKind !== 'redis') return new InMemoryHitlRepository();

  const redis = createRedisClient(params.redisUrl);

  try {
    await redis.connect();
    await redis.ping();
    return new RedisHitlRepository(redis, params.redisPrefix, params.ttlSeconds);
  } catch {
    try {
      await redis.quit();
    } catch {
      // ignore quit errors during fallback
    }
    return new InMemoryHitlRepository();
  }
}

export async function createRuntime() {
  const config = await loadConfig();
  const logger = new Logger(config.observability.logLevel);
  const metrics = new HitlMetrics();
  const repository = await resolveRepository({
    storageKind: config.storage.kind,
    redisUrl: config.redis.url,
    redisPrefix: config.redis.keyPrefix,
    ttlSeconds: config.ttl.defaultSeconds
  });
  const waiter = new Waiter();
  const service = new HitlService(
    repository,
    waiter,
    config.pending.maxWaitSeconds,
    config.pending.waitMode,
    metrics
  );
  const server = new MCPServer({
    name: config.server.name,
    title: 'HITL MCP',
    version: config.server.version,
    description: 'Human-in-the-loop MCP server with HTTP control plane.',
    baseUrl: config.server.baseUrl,
    favicon: 'favicon.ico',
    icons: [
      {
        src: 'icon.svg',
        mimeType: 'image/svg+xml',
        sizes: ['512x512']
      }
    ]
  });
  server.use('mcp:tools/call', async (ctx, next) => {
    injectCallerScopeIntoMcpState(ctx, {
      sessionHeader: config.agentIdentity.sessionHeader
    });
    return next();
  });
  registerHitlTools(server, service);
  const app = server.app;

  app.use('*', requestIdMiddleware);
  app.use('*', async (c, next) => {
    const startedAt = Date.now();
    await next();
    const requestId = c.get('requestId') ?? 'local';
    const traceId = c.get('traceId') ?? requestId;
    logger.info('http_request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
      trace_id: traceId
    });
  });

  const apiKey = config.security.apiKey;
  const questionContext = requestContextMiddleware({
    sessionHeader: config.agentIdentity.sessionHeader,
    resolveAgentIdentity: (c) =>
      c.get('agentIdentity') ??
      resolveApiKeyPrincipal(c, apiKey ?? '') ??
      c.req.header('x-agent-identity') ??
      null
  });

  if (apiKey) {
    app.use('/mcp*', apiKeyAuth(apiKey));
    app.use(
      '/mcp*',
      requestContextMiddleware({
        sessionHeader: config.agentIdentity.sessionHeader,
        resolveAgentIdentity: (c) => c.get('agentIdentity') ?? resolveApiKeyPrincipal(c, apiKey)
      })
    );
    app.use(`${config.http.apiPrefix}/questions/*`, apiKeyAuth(apiKey));
  }

  app.use(`${config.http.apiPrefix}/questions`, questionContext);
  app.use(`${config.http.apiPrefix}/questions/pending`, questionContext);
  app.use(`${config.http.apiPrefix}/questions/answers`, questionContext);
  app.use(`${config.http.apiPrefix}/questions/cancel`, questionContext);

  app.get(`${config.http.apiPrefix}/healthz`, (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' }));
  });

  app.get(`${config.http.apiPrefix}/readyz`, async (c) => {
    const ready = (await repository.isReady?.()) ?? true;
    if (!ready) {
      return c.json(
        ok(c.get('requestId') ?? 'local', { status: 'not_ready' }),
        503
      );
    }

    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ready' }));
  });

  app.get(`${config.http.apiPrefix}/metrics`, (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', metrics.snapshot()));
  });

  app.route(config.http.apiPrefix, questionRoutes({ service, metrics }));

  return { app, server, repository, waiter, service, config, metrics };
}

export async function createHttpApp() {
  const runtime = await createRuntime();
  return runtime.app;
}
