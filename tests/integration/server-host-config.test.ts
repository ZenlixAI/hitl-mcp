import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('server host config', () => {
  it('uses configured http host as MCP server host by default', async () => {
    const runtime = await createRuntime();

    expect((runtime.server as { serverHost?: string }).serverHost).toBe('0.0.0.0');
  });

  it('uses overridden http host as MCP server host', async () => {
    process.env.HITL_HTTP_HOST = '127.0.0.1';

    try {
      const runtime = await createRuntime();

      expect((runtime.server as { serverHost?: string }).serverHost).toBe('127.0.0.1');
    } finally {
      delete process.env.HITL_HTTP_HOST;
    }
  });
});
