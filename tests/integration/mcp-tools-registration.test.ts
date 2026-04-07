import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('mcp tool registration', () => {
  it('registers create wait and current tools', async () => {
    const runtime = await createRuntime();
    const names = runtime.server.registeredTools.sort();

    expect(names).toContain('hitl_create_request');
    expect(names).toContain('hitl_wait_request');
    expect(names).toContain('hitl_get_current_request');
  });
});
