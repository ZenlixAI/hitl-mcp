import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('GET /requests/current', () => {
  beforeEach(() => {
    process.env.HITL_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.HITL_API_KEY;
  });

  it('returns current pending request for authenticated caller scope', async () => {
    const runtime = await createRuntime();
    const created = await runtime.repository.createPendingGroup({
      agent_identity: 'api_key:test-api-key',
      agent_session_id: 'session-123',
      title: 'Current group',
      questions: [{ question_id: 'q_current_1', type: 'boolean', title: 'Approve?' }]
    });

    const res = await runtime.app.request('/api/v1/requests/current', {
      headers: {
        'x-api-key': 'test-api-key',
        'x-agent-session-id': 'session-123'
      }
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.request_id).toBe(created.question_group_id);
    expect(body.data.status).toBe('pending');
  });
});
