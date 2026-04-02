import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/server/create-server';

describe('security auth middleware', () => {
  beforeEach(() => {
    process.env.HITL_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.HITL_API_KEY;
  });

  it('returns 401 when api key is missing', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/question-groups/qg_1');
    expect(res.status).toBe(401);
  });

  it('returns non-401 when api key is present', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/question-groups/qg_1', {
      headers: { 'x-api-key': 'test-api-key' }
    });

    expect(res.status).toBe(404);
  });
});
