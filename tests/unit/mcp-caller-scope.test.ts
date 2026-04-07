import { Hono } from 'hono';
import type { MiddlewareContext } from 'mcp-use/server';
import { runWithContext } from 'mcp-use/server';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors';
import { injectCallerScopeIntoMcpState, readCallerScopeFromMcpContext } from '../../src/mcp/caller-scope';

describe('mcp caller scope bridge', () => {
  it('copies agent identity and session id from request context into mcp state', async () => {
    const app = new Hono();

    app.get('/check', async (c) => {
      c.set('agentIdentity', 'agent/runtime-1');
      c.set('agentSessionId', 'session-123');

      const mcpContext: MiddlewareContext = {
        method: 'tools/call',
        params: { name: 'hitl_ask' },
        state: new Map()
      };

      const caller = await runWithContext(c, async () => {
        injectCallerScopeIntoMcpState(mcpContext, { sessionHeader: 'x-agent-session-id' });
        return readCallerScopeFromMcpContext(mcpContext);
      });

      return c.json(caller);
    });

    const res = await app.request('/check');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      agent_identity: 'agent/runtime-1',
      agent_session_id: 'session-123'
    });
  });

  it('rejects missing agent session id in mcp request context', async () => {
    const app = new Hono();

    app.get('/check', async (c) => {
      c.set('agentIdentity', 'agent/runtime-1');

      const mcpContext: MiddlewareContext = {
        method: 'tools/call',
        params: { name: 'hitl_ask' },
        state: new Map()
      };

      return runWithContext(c, async () => {
        try {
          injectCallerScopeIntoMcpState(mcpContext, { sessionHeader: 'x-agent-session-id' });
          return c.json({ ok: true });
        } catch (error) {
          return c.json({
            name: error instanceof Error ? error.name : 'unknown',
            code: error instanceof DomainError ? error.code : 'unknown'
          });
        }
      });
    });

    const res = await app.request('/check');
    const body = await res.json();

    expect(body).toEqual({
      name: 'Error',
      code: 'AGENT_SESSION_ID_REQUIRED'
    });
  });
});
