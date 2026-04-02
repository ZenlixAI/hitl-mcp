import type { Context, MiddlewareHandler } from 'hono';
import { fail } from '../response';

export function requestContextMiddleware(params: {
  sessionHeader: string;
  resolveAgentIdentity: (c: Context) => string | null;
}): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') ?? 'local';
    const agentIdentity = params.resolveAgentIdentity(c);

    if (!agentIdentity) {
      return c.json(
        fail(requestId, 'AGENT_IDENTITY_REQUIRED', 'agent identity required'),
        401
      );
    }

    const agentSessionId = c.req.header(params.sessionHeader);

    if (!agentSessionId) {
      return c.json(
        fail(requestId, 'AGENT_SESSION_ID_REQUIRED', 'agent session id required'),
        400
      );
    }

    c.set('agentIdentity', agentIdentity);
    c.set('agentSessionId', agentSessionId);
    await next();
  };
}
