import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('sse route context wiring', () => {
  it('applies question context middleware to the sse endpoint prefix', async () => {
    const runtime = await createRuntime();
    const sseMiddlewareRoutes = runtime.app.routes.filter(
      (route) => route.path === '/sse*' && route.method === 'ALL'
    );

    expect(sseMiddlewareRoutes).toHaveLength(1);
  });
});
