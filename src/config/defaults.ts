import type { AppConfig } from './types';

export const defaultConfig: AppConfig = {
  http: { host: '0.0.0.0', port: 3000, apiPrefix: '/api/v1' },
  redis: { url: 'redis://127.0.0.1:6379', keyPrefix: 'hitl' },
  ttl: { defaultSeconds: 7 * 24 * 3600, answeredRetentionSeconds: 30 * 24 * 3600 },
  pending: { maxWaitSeconds: 0 },
  security: { apiKey: 'dev-only-key' }
};
