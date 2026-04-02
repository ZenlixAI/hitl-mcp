import { Hono } from 'hono';
import { loadConfig } from '../config/load-config';
import { HitlService } from '../core/hitl-service';
import { apiKeyAuth } from '../http/middleware/auth';
import { requestIdMiddleware } from '../http/middleware/request-id';
import { questionRoutes } from '../http/routes/questions';
import { questionGroupRoutes } from '../http/routes/question-groups';
import { ok } from '../http/response';
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
  const app = new Hono();
  const logger = new Logger(config.observability.logLevel);
  const metrics = new HitlMetrics();
  const repository = await resolveRepository({
    storageKind: config.storage.kind,
    redisUrl: config.redis.url,
    redisPrefix: config.redis.keyPrefix,
    ttlSeconds: config.ttl.defaultSeconds
  });
  const waiter = new Waiter();
  const service = new HitlService(repository, waiter, config.pending.maxWaitSeconds, metrics);

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
  if (apiKey) {
    app.use(`${config.http.apiPrefix}/question-groups/*`, apiKeyAuth(apiKey));
    app.use(`${config.http.apiPrefix}/questions/*`, apiKeyAuth(apiKey));
  }

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

  app.route(config.http.apiPrefix, questionGroupRoutes({ repository, waiter, metrics }));
  app.route(config.http.apiPrefix, questionRoutes({ repository }));

  return { app, repository, waiter, service, config, metrics };
}

export async function createHttpApp() {
  const runtime = await createRuntime();
  return runtime.app;
}
