import { Hono } from 'hono';
import { requestIdMiddleware } from '../http/middleware/request-id';
import { questionGroupRoutes } from '../http/routes/question-groups';
import { ok } from '../http/response';
import { InMemoryHitlRepository } from '../storage/in-memory-repository';
import { Waiter } from '../state/waiter';

export async function createHttpApp() {
  const app = new Hono();
  const repository = new InMemoryHitlRepository();
  const waiter = new Waiter();

  app.use('*', requestIdMiddleware);

  app.get('/api/v1/healthz', (c) => {
    return c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' }));
  });

  app.route('/api/v1', questionGroupRoutes({ repository, waiter }));

  return app;
}
