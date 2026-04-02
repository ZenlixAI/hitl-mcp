import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { loadConfig, resolveConfig } from '../../src/config/load-config';

describe('config loader file priority', () => {
  it('applies env > .env > yaml > defaults across mapped fields', async () => {
    const base = await mkdtemp(join(tmpdir(), 'hitl-config-'));

    const yamlPath = join(base, 'hitl.yaml');
    const dotenvPath = join(base, '.env');

    await writeFile(
      yamlPath,
      [
        'http:',
        '  host: 1.1.1.1',
        '  port: 1111',
        'redis:',
        '  url: redis://yaml:6379',
        'pending:',
        '  maxWaitSeconds: 111'
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      dotenvPath,
      [
        'HITL_HTTP_PORT=2222',
        'HITL_REDIS_URL=redis://dotenv:6379',
        'HITL_PENDING_MAX_WAIT_SECONDS=222'
      ].join('\n'),
      'utf8'
    );

    const config = await loadConfig({
      yamlPath,
      dotenvPath,
      env: {
        HITL_HTTP_PORT: '3333',
        HITL_REDIS_URL: 'redis://env:6379',
        HITL_PENDING_MAX_WAIT_SECONDS: '333'
      }
    });

    expect(config.http.host).toBe('1.1.1.1');
    expect(config.http.port).toBe(3333);
    expect(config.redis.url).toBe('redis://env:6379');
    expect(config.pending.maxWaitSeconds).toBe(333);
  });

  it('loads agent identity auth mode, session header, and conflict policy from env', async () => {
    const config = await resolveConfig({
      env: {
        HITL_AGENT_AUTH_MODE: 'api_key',
        HITL_AGENT_SESSION_HEADER: 'x-agent-session-id',
        HITL_CREATE_CONFLICT_POLICY: 'error'
      }
    });

    expect(config.agentIdentity.authMode).toBe('api_key');
    expect(config.agentIdentity.sessionHeader).toBe('x-agent-session-id');
    expect(config.agentIdentity.createConflictPolicy).toBe('error');
  });
});
