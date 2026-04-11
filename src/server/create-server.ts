import { MCPServer } from 'mcp-use/server';
import { loadConfig } from '../config/load-config.js';
import { HitlService } from '../core/hitl-service.js';
import { requestContextMiddleware } from '../http/middleware/request-context.js';
import { requestIdMiddleware } from '../http/middleware/request-id.js';
import { questionRoutes } from '../http/routes/questions.js';
import { fail, ok } from '../http/response.js';
import { injectCallerScopeIntoMcpState } from '../mcp/caller-scope.js';
import { registerHitlTools } from '../mcp/register-tools.js';
import { Logger } from '../observability/logger.js';
import { HitlMetrics } from '../observability/metrics.js';
import type { HitlRepository } from '../storage/hitl-repository.js';
import { InMemoryHitlRepository } from '../storage/in-memory-repository.js';
import { createRedisClient } from '../storage/redis-client.js';
import { RedisHitlRepository } from '../storage/redis-hitl-repository.js';
import { Waiter } from '../state/waiter.js';

async function resolveRepository(params: {
  storageKind: 'memory' | 'redis';
  redisUrl: string;
  redisPrefix: string;
  ttlSeconds: number;
  logger: Logger;
}): Promise<HitlRepository> {
  if (params.storageKind !== 'redis') return new InMemoryHitlRepository();

  const redis = createRedisClient(params.redisUrl);

  try {
    await redis.connect();
    await redis.ping();
    return new RedisHitlRepository(redis, params.redisPrefix, params.ttlSeconds);
  } catch (error) {
    params.logger.warn('redis_repository_unavailable', {
      redis_url: params.redisUrl,
      error
    });
    try {
      await redis.quit();
    } catch (quitError) {
      params.logger.warn('redis_quit_failed', {
        redis_url: params.redisUrl,
        error: quitError
      });
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
    ttlSeconds: config.ttl.defaultSeconds,
    logger
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
    try {
      injectCallerScopeIntoMcpState(ctx, {
        sessionHeader: config.agentIdentity.sessionHeader
      });
      return next();
    } catch (error) {
      logger.warn('mcp_caller_scope_injection_failed', {
        tool_name: String((ctx as { params?: { name?: string } }).params?.name ?? 'unknown'),
        error
      });
      throw error;
    }
  });
  registerHitlTools(server, service, logger);
  const app = server.app;

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'local';
    logger.error('http_unhandled_error', {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      error
    });
    return c.json(
      fail(requestId, 'INTERNAL_SERVER_ERROR', 'internal server error'),
      500
    );
  });

  app.use('*', requestIdMiddleware);
  app.use('*', async (c, next) => {
    const startedAt = Date.now();
    await next();
    const requestId = c.get('requestId') ?? 'local';
    const traceId = c.get('traceId') ?? requestId;
    const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info';
    logger[level]('http_request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - startedAt,
      request_id: requestId,
      trace_id: traceId
    });
  });

  const questionContext = requestContextMiddleware({
    sessionHeader: config.agentIdentity.sessionHeader
  });

  app.use('/mcp*', questionContext);

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

  app.route(config.http.apiPrefix, questionRoutes({ service, metrics, logger }));

  return { app, server, repository, waiter, service, config, metrics };
}

export async function createHttpApp() {
  const runtime = await createRuntime();
  return runtime.app;
}
