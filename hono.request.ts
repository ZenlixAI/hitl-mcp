import { Hono } from 'hono';
import { requestIdMiddleware } from './src/http/middleware/request-id';
import { questionRoutes } from './src/http/routes/questions';
import { questionGroupRoutes } from './src/http/routes/question-groups';
import { ok } from './src/http/response';
import { InMemoryHitlRepository } from './src/storage/in-memory-repository';
import { Waiter } from './src/state/waiter';

const app = new Hono();
const repository = new InMemoryHitlRepository();
const waiter = new Waiter();

app.use('*', requestIdMiddleware);
app.get('/api/v1/healthz', (c) => c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' })));
app.route('/api/v1', questionGroupRoutes({ repository, waiter }));
app.route('/api/v1', questionRoutes({ repository }));

export default app;
