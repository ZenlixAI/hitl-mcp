import { describe, it, expect } from 'vitest';
import { createHttpApp, createRuntime } from '../../src/server/create-server';

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

describe('http finalize validation', () => {
  it('returns 422 when answers are invalid and keeps pending', async () => {
    const runtime = await createRuntime();
    await runtime.repository.createPendingGroup({
      question_group_id: 'qg_invalid_1',
      title: 'group',
      questions: [
        {
          question_id: 'q_range_1',
          type: 'range',
          title: 'score',
          range_constraints: { min: 0, max: 10, step: 1 }
        }
      ]
    });

    const res = await runtime.app.request('/api/v1/question-groups/qg_invalid_1/answers/finalize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { q_range_1: { value: 99 } } })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ANSWER_VALIDATION_FAILED');

    const status = await runtime.repository.getGroupStatus('qg_invalid_1');
    expect(status?.status).toBe('pending');
  });
});
