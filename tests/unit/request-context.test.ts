import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requestContextMiddleware } from '../../src/http/middleware/request-context.js';

describe('request context middleware', () => {
  it('extracts agent identity and session id from headers', async () => {
    const app = new Hono();

    app.use('*', requestContextMiddleware({ sessionHeader: 'x-agent-session-id' }));

    app.get('/check', (c) =>
      c.json({
        agent_identity: c.get('agentIdentity'),
        agent_session_id: c.get('agentSessionId')
      })
    );

    const res = await app.request('/check', {
      headers: {
        'x-agent-identity': 'agent/runtime-1',
        'x-agent-session-id': 'session-123'
      }
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agent_identity).toBe('agent/runtime-1');
    expect(body.agent_session_id).toBe('session-123');
  });
});
