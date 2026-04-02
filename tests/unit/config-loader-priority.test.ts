import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/load-config';

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
});
