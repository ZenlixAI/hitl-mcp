import { getRequestContext, type MiddlewareContext } from 'mcp-use/server';
import { DomainError } from '../domain/errors';
import type { CallerScope } from '../domain/types';

export function injectCallerScopeIntoMcpState(
  ctx: MiddlewareContext,
  params: { sessionHeader: string }
) {
  const requestContext = getRequestContext();
  if (!requestContext) {
    throw new DomainError('AGENT_IDENTITY_REQUIRED', 'agent identity required');
  }

  const agentIdentity =
    requestContext.get('agentIdentity') ?? requestContext.req.header('x-agent-identity');

  if (!agentIdentity) {
    throw new DomainError('AGENT_IDENTITY_REQUIRED', 'agent identity required');
  }

  const agentSessionId =
    requestContext.get('agentSessionId') ?? requestContext.req.header(params.sessionHeader);

  if (!agentSessionId) {
    throw new DomainError('AGENT_SESSION_ID_REQUIRED', 'agent session id required');
  }

  ctx.state.set('agentIdentity', agentIdentity);
  ctx.state.set('agentSessionId', agentSessionId);
}

export function readCallerScopeFromMcpContext(ctx: unknown): CallerScope {
  const source = ctx as {
    state?: Map<string, unknown>;
    agentIdentity?: unknown;
    agentSessionId?: unknown;
  };
  const agentIdentity = source.state?.get('agentIdentity') ?? source.agentIdentity;
  if (typeof agentIdentity !== 'string' || agentIdentity.length === 0) {
    throw new DomainError('AGENT_IDENTITY_REQUIRED', 'agent identity required');
  }

  const agentSessionId = source.state?.get('agentSessionId') ?? source.agentSessionId;
  if (typeof agentSessionId !== 'string' || agentSessionId.length === 0) {
    throw new DomainError('AGENT_SESSION_ID_REQUIRED', 'agent session id required');
  }

  return {
    agent_identity: agentIdentity,
    agent_session_id: agentSessionId
  };
}
