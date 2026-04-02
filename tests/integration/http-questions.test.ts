import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('http questions route', () => {
  it('returns question by question id', async () => {
    const { app, repository } = await createRuntime();

    await repository.createPendingGroup({
      question_group_id: 'qg_qroute_1',
      title: 'group',
      questions: [
        {
          question_id: 'q_route_1',
          type: 'text',
          title: 'Why?'
        }
      ]
    });

    const res = await app.request('/api/v1/questions/q_route_1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.question_id).toBe('q_route_1');
  });
});
