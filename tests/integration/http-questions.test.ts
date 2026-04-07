import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('http questions route', () => {
  it('returns question by question id', async () => {
    const { app, repository } = await createRuntime();

    await repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-route-1',
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

  it('returns all pending questions for the current caller scope', async () => {
    const { app, repository } = await createRuntime();

    await repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-route-2',
      title: 'group',
      questions: [
        {
          question_id: 'q_pending_1',
          type: 'text',
          title: 'first'
        },
        {
          question_id: 'q_pending_2',
          type: 'boolean',
          title: 'second'
        }
      ]
    });

    const res = await app.request('/api/v1/questions/pending', {
      headers: {
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-route-2'
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.pending_questions).toHaveLength(2);
    expect(body.data.pending_questions.map((item: { question_id: string }) => item.question_id).sort()).toEqual([
      'q_pending_1',
      'q_pending_2'
    ]);
  });
});
