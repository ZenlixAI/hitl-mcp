import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../../src/observability/logger.js';
import { attachMcpSessionLogging } from '../../src/mcp/session-logging.js';

describe('mcp session logging', () => {
  it('logs session connect, outbound message delivery, and disconnect', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger('info');
    const transport = {
      send: vi.fn().mockResolvedValue(undefined)
    };
    const server = {
      sessions: new Map<string, any>()
    };

    attachMcpSessionLogging(server as any, logger);

    server.sessions.set('sess-1', {
      transport,
      context: {
        get: (key: string) => {
          if (key === 'agentIdentity') return 'agent/test';
          if (key === 'agentSessionId') return 'session/test';
          return undefined;
        }
      }
    });

    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progress: 30 }
    });

    server.sessions.delete('sess-1');

    const logs = consoleLogSpy.mock.calls
      .map(([entry]) => String(entry))
      .map((entry) => JSON.parse(entry));

    expect(logs.find((entry) => entry.message === 'mcp_session_connected')).toMatchObject({
      level: 'info',
      session_id: 'sess-1',
      agent_identity: 'agent/test',
      agent_session_id: 'session/test'
    });
    expect(logs.find((entry) => entry.message === 'mcp_client_message_sent')).toMatchObject({
      level: 'info',
      session_id: 'sess-1',
      method: 'notifications/progress',
      message_kind: 'notification',
      agent_identity: 'agent/test',
      agent_session_id: 'session/test'
    });
    expect(logs.find((entry) => entry.message === 'mcp_session_disconnected')).toMatchObject({
      level: 'info',
      session_id: 'sess-1',
      agent_identity: 'agent/test',
      agent_session_id: 'session/test'
    });

    consoleLogSpy.mockRestore();
  });
});
