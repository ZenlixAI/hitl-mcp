import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/config/load-config';

describe('config loader', () => {
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
});
