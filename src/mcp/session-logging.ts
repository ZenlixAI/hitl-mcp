import type { Logger } from '../observability/logger.js';

type SessionEntry = {
  transport?: {
    send?: (message: unknown, options?: unknown) => Promise<unknown>;
  };
  context?: {
    get?: (key: string) => unknown;
    req?: {
      header?: (name: string) => string | undefined;
    };
  };
};

function asSessionEntry(session: unknown): SessionEntry {
  return (session ?? {}) as SessionEntry;
}

function readCallerContext(session: unknown) {
  const entry = asSessionEntry(session);
  const agentIdentity =
    entry.context?.get?.('agentIdentity') ??
    entry.context?.req?.header?.('x-agent-identity');
  const agentSessionId =
    entry.context?.get?.('agentSessionId') ??
    entry.context?.req?.header?.('x-agent-session-id');

  return {
    ...(typeof agentIdentity === 'string' ? { agent_identity: agentIdentity } : {}),
    ...(typeof agentSessionId === 'string' ? { agent_session_id: agentSessionId } : {})
  };
}

function classifyMessage(message: unknown) {
  const payload = message as {
    method?: unknown;
    id?: unknown;
    result?: unknown;
    error?: unknown;
  };

  if (typeof payload.method === 'string' && payload.id === undefined) {
    return { message_kind: 'notification', method: payload.method };
  }
  if (typeof payload.method === 'string') {
    return {
      message_kind: 'request',
      method: payload.method,
      request_id: payload.id
    };
  }
  if (payload.result !== undefined || payload.error !== undefined) {
    return {
      message_kind: 'response',
      request_id: payload.id
    };
  }
  return { message_kind: 'unknown' };
}

export function attachMcpSessionLogging(
  server: { sessions: Map<string, unknown> },
  logger: Logger
) {
  const sessions = server.sessions;
  const wrappedTransports = new WeakSet<object>();

  const originalSet = sessions.set.bind(sessions);
  sessions.set = ((sessionId, session) => {
    const entry = asSessionEntry(session);

    if (
      entry.transport?.send &&
      typeof entry.transport.send === 'function' &&
      !wrappedTransports.has(entry.transport as object)
    ) {
      const originalSend = entry.transport.send.bind(entry.transport);
      entry.transport.send = async (message: unknown, options?: unknown) => {
        try {
          const result = await originalSend(message, options);
          logger.info('mcp_client_message_sent', {
            session_id: sessionId,
            ...readCallerContext(sessions.get(sessionId) ?? entry),
            ...classifyMessage(message)
          });
          return result;
        } catch (error) {
          logger.warn('mcp_client_message_send_failed', {
            session_id: sessionId,
            ...readCallerContext(sessions.get(sessionId) ?? entry),
            ...classifyMessage(message),
            error
          });
          throw error;
        }
      };
      wrappedTransports.add(entry.transport as object);
    }

    logger.info('mcp_session_connected', {
      session_id: sessionId,
      ...readCallerContext(entry)
    });

    return originalSet(sessionId, entry);
  }) as typeof sessions.set;

  const originalDelete = sessions.delete.bind(sessions);
  sessions.delete = ((sessionId) => {
    logger.info('mcp_session_disconnected', {
      session_id: sessionId,
      ...readCallerContext(sessions.get(sessionId))
    });
    return originalDelete(sessionId);
  }) as typeof sessions.delete;
}
