import { MCPServer } from 'mcp-use/server';
import { loadConfig } from './src/config/load-config';
import { HitlService } from './src/core/hitl-service';
import { apiKeyAuth } from './src/http/middleware/auth';
import { requestIdMiddleware } from './src/http/middleware/request-id';
import { questionRoutes } from './src/http/routes/questions';
import { questionGroupRoutes } from './src/http/routes/question-groups';
import { ok } from './src/http/response';
import { registerHitlTools } from './src/mcp/register-tools';
import { Logger } from './src/observability/logger';
import { HitlMetrics } from './src/observability/metrics';
import { Waiter } from './src/state/waiter';
import type { HitlRepository } from './src/storage/hitl-repository';
import { InMemoryHitlRepository } from './src/storage/in-memory-repository';
import { createRedisClient } from './src/storage/redis-client';
import { RedisHitlRepository } from './src/storage/redis-hitl-repository';

async function resolveRepository(config: Awaited<ReturnType<typeof loadConfig>>): Promise<HitlRepository> {
  if (config.storage.kind !== 'redis') return new InMemoryHitlRepository();
  const redis = createRedisClient(config.redis.url);
  try {
    await redis.connect();
    await redis.ping();
    return new RedisHitlRepository(redis, config.redis.keyPrefix, config.ttl.defaultSeconds);
  } catch {
    try {
      await redis.quit();
    } catch {
      // ignore quit failures in fallback path
    }
    return new InMemoryHitlRepository();
  }
}

async function main() {
  const config = await loadConfig();
  const logger = new Logger(config.observability.logLevel);
  const metrics = new HitlMetrics();
  const repository = await resolveRepository(config);
  const waiter = new Waiter();

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

  const service = new HitlService(repository, waiter, config.pending.maxWaitSeconds, metrics);
  registerHitlTools(server, service);

  server.use(requestIdMiddleware);
  server.use(async (c, next) => {
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

  if (config.security.apiKey) {
    server.use(`${config.http.apiPrefix}/question-groups/*`, apiKeyAuth(config.security.apiKey));
    server.use(`${config.http.apiPrefix}/questions/*`, apiKeyAuth(config.security.apiKey));
  }

  server.app.get(`${config.http.apiPrefix}/healthz`, (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' }));
  });

  server.app.get(`${config.http.apiPrefix}/readyz`, async (c) => {
    const ready = (await repository.isReady?.()) ?? true;
    if (!ready) {
      return c.json(ok(c.get('requestId') ?? 'local', { status: 'not_ready' }), 503);
    }

    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ready' }));
  });

  server.app.get(`${config.http.apiPrefix}/metrics`, (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', metrics.snapshot()));
  });

  server.app.route(config.http.apiPrefix, questionGroupRoutes({ repository, waiter, metrics }));
  server.app.route(config.http.apiPrefix, questionRoutes({ repository }));

  server.listen(config.http.port);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
