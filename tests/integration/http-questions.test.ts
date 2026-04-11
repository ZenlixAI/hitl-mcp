import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('http questions route', () => {
  it('creates questions with server-generated question_id values', async () => {
    const { app } = await createRuntime();

    const res = await app.request('/api/v1/questions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-create-1'
      },
      body: JSON.stringify({
        title: 'group',
        questions: [
          {
            type: 'text',
            title: 'Why?'
          }
        ]
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.questions).toHaveLength(1);
    expect(body.data.questions[0].question_id).toMatch(/^q_/);
    expect(body.data.questions[0].title).toBe('Why?');
  });

  it('returns question by question id', async () => {
    const { app, repository } = await createRuntime();

    const created = await repository.createPendingGroup({
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
    const questionId = String(created.questions[0].question_id);

    const res = await app.request(`/api/v1/questions/${questionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.question_id).toBe(questionId);
  });

  it('returns all pending questions for the current caller scope', async () => {
    const { app, repository } = await createRuntime();

    const created = await repository.createPendingGroup({
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
    expect(body.data.pending_questions.map((item: { question_id: string }) => item.question_id).sort()).toEqual(
      created.questions.map((item: { question_id: string }) => item.question_id).sort()
    );
  });
});
