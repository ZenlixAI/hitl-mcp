import { describe, it, expect } from 'vitest';
import { createHttpApp } from '../../src/server/create-server';

describe('http finalize api', () => {
  it('returns 404 when group does not exist', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/question-groups/qg_missing/answers/finalize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q_1: { value: 'A' } } })
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('QUESTION_GROUP_NOT_FOUND');
  });
});
