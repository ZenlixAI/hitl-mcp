import { Hono } from 'hono';
import { HitlService } from '../core/hitl-service';
import { requestIdMiddleware } from '../http/middleware/request-id';
import { questionRoutes } from '../http/routes/questions';
import { questionGroupRoutes } from '../http/routes/question-groups';
import { ok } from '../http/response';
import { InMemoryHitlRepository } from '../storage/in-memory-repository';
import { Waiter } from '../state/waiter';

export async function createRuntime() {
  const app = new Hono();
  const repository = new InMemoryHitlRepository();
  const waiter = new Waiter();
  const service = new HitlService(repository, waiter, 0);

  app.use('*', requestIdMiddleware);

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
