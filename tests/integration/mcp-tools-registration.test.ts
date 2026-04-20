import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('mcp tool registration', () => {
  it('registers only the single agent-facing ask-and-wait tool', async () => {
    const runtime = await createRuntime();
    const names = runtime.server.registeredTools.sort();

    expect(names).toEqual(['hitl_ask_user']);
  });
});
