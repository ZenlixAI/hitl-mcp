import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/config/load-config.js';

describe('config loader', () => {
  it('uses 0.0.0.0:3000 as default host and port', async () => {
    const config = await resolveConfig({
      env: {}
    });

    expect(config.http.host).toBe('0.0.0.0');
    expect(config.http.port).toBe(3000);
    expect(config.server.baseUrl).toBe('http://0.0.0.0:3000');
  });

  it('applies precedence env > dotenv > yaml > defaults', async () => {
    const config = await resolveConfig({
      env: { HITL_HTTP_PORT: '7777' },
      dotenv: { HITL_HTTP_PORT: '6666' },
      yaml: { http: { port: 5555 } }
    });

    expect(config.http.port).toBe(7777);
  });

  it('loads wait mode from env', async () => {
    const config = await resolveConfig({
      env: { HITL_WAIT_MODE: 'progressive' }
    });

    expect(config.pending.waitMode).toBe('progressive');
  });

  it('uses 15 minutes and 5 seconds as timeout defaults', async () => {
    const config = await resolveConfig({ env: {} });

    expect(config.pending.defaultTimeoutSeconds).toBe(900);
    expect(config.pending.timeoutPollIntervalSeconds).toBe(5);
  });

  it('loads timeout config from env', async () => {
    const config = await resolveConfig({
      env: {
        HITL_PENDING_DEFAULT_TIMEOUT_SECONDS: '1200',
        HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS: '9'
      }
    });

    expect(config.pending.defaultTimeoutSeconds).toBe(1200);
    expect(config.pending.timeoutPollIntervalSeconds).toBe(9);
  });
});
