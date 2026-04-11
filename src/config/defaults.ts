import type { AppConfig } from './types.js';

export const defaultConfig: AppConfig = {
  server: { name: 'hitl-mcp', version: '0.1.0', baseUrl: 'http://0.0.0.0:3000' },
  http: { host: '0.0.0.0', port: 3000, apiPrefix: '/api/v1' },
  storage: { kind: 'memory' },
  redis: { url: 'redis://127.0.0.1:6379', keyPrefix: 'hitl' },
  ttl: { defaultSeconds: 7 * 24 * 3600, answeredRetentionSeconds: 30 * 24 * 3600 },
  pending: { maxWaitSeconds: 0, waitMode: 'terminal_only' },
  agentIdentity: {
    sessionHeader: 'x-agent-session-id',
    createConflictPolicy: 'error'
  },
  observability: { logLevel: 'info', enableMetrics: true }
};
