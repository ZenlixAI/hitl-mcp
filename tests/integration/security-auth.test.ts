import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/server/create-server';

describe('caller context middleware', () => {
  it('returns 401 when agent identity header is missing', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/questions/pending', {
      headers: {
        'x-agent-session-id': 'session-1'
      }
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AGENT_IDENTITY_REQUIRED');
  });

  it('returns 400 when agent session header is missing', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/questions/pending', {
      headers: {
        'x-agent-identity': 'agent/test-1'
      }
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('AGENT_SESSION_ID_REQUIRED');
  });

  it('allows access when both agent identity and session headers are present', async () => {
    const app = await createHttpApp();
    const res = await app.request('/api/v1/questions/q_1', {
      headers: {
        'x-agent-identity': 'agent/test-1',
        'x-agent-session-id': 'session-1'
      }
    });

    expect(res.status).toBe(404);
  });
});
