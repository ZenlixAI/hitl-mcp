import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('mcp tool registration', () => {
  it('registers question-only tools', async () => {
    const runtime = await createRuntime();
    const names = runtime.server.registeredTools.sort();

    expect(names).toContain('hitl_ask');
    expect(names).toContain('hitl_wait');
    expect(names).toContain('hitl_get_pending_questions');
    expect(names).toContain('hitl_submit_answers');
    expect(names).toContain('hitl_cancel_questions');
    expect(names).toContain('hitl_get_question');
  });
});
