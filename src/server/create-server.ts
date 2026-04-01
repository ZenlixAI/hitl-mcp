import { Hono } from 'hono';

export async function createHttpApp() {
  const app = new Hono();

  app.get('/api/v1/healthz', (c) => {
    return c.json({
      request_id: 'local',
      success: true,
      data: { status: 'ok' },
      error: null
    });
  });

  return app;
}
