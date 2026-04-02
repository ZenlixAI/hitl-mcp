import { Hono } from 'hono';
import { HitlService } from '../core/hitl-service';
import { apiKeyAuth } from '../http/middleware/auth';
import { requestIdMiddleware } from '../http/middleware/request-id';
import { questionRoutes } from '../http/routes/questions';
import { questionGroupRoutes } from '../http/routes/question-groups';
import { ok } from '../http/response';
import type { HitlRepository } from '../storage/hitl-repository';
import { InMemoryHitlRepository } from '../storage/in-memory-repository';
import { createRedisClient } from '../storage/redis-client';
import { RedisHitlRepository } from '../storage/redis-hitl-repository';
import { Waiter } from '../state/waiter';

async function resolveRepository(): Promise<HitlRepository> {
  const useRedis = process.env.HITL_STORAGE === 'redis';
  if (!useRedis) return new InMemoryHitlRepository();

  const redisUrl = process.env.HITL_REDIS_URL || 'redis://127.0.0.1:6379';
  const prefix = process.env.HITL_REDIS_PREFIX || 'hitl';
  const ttlSeconds = Number(process.env.HITL_TTL_SECONDS || '604800');
  const redis = createRedisClient(redisUrl);

  try {
    await redis.connect();
    await redis.ping();
    return new RedisHitlRepository(redis, prefix, ttlSeconds);
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
  const app = new Hono();
  const repository = await resolveRepository();
  const waiter = new Waiter();
  const service = new HitlService(repository, waiter, 0);

  app.use('*', requestIdMiddleware);
  const apiKey = process.env.HITL_API_KEY;
  if (apiKey) {
    app.use('/api/v1/question-groups/*', apiKeyAuth(apiKey));
    app.use('/api/v1/questions/*', apiKeyAuth(apiKey));
  }

  app.get('/api/v1/healthz', (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' }));
  });

  app.route('/api/v1', questionGroupRoutes({ repository, waiter }));
  app.route('/api/v1', questionRoutes({ repository }));

  return { app, repository, waiter, service };
}

export async function createHttpApp() {
  const runtime = await createRuntime();
  return runtime.app;
}
