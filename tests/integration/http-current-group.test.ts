import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('GET /questions/pending', () => {
  it('returns pending questions for caller scope from headers', async () => {
    const runtime = await createRuntime();
    const created = await runtime.repository.createPendingGroup({
      agent_identity: 'agent/runtime-1',
      agent_session_id: 'session-123',
      title: 'Current group',
      questions: [
        { question_id: 'q_current_1', type: 'boolean', title: 'Approve?' },
        { question_id: 'q_current_2', type: 'text', title: 'Why?', required: false }
      ]
    });

    const res = await runtime.app.request('/api/v1/questions/pending', {
      headers: {
        'x-agent-identity': 'agent/runtime-1',
        'x-agent-session-id': 'session-123'
      }
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.pending_questions.map((item: { question_id: string }) => item.question_id).sort()).toEqual(
      created.questions.map((item: { question_id: string }) => item.question_id).sort()
    );
  });
});
