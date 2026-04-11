import { describe, it, expect } from 'vitest';
import { createHttpApp } from '../../src/server/create-server.js';

describe('bootstrap', () => {
  it('exposes health endpoint', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/healthz');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });
});
