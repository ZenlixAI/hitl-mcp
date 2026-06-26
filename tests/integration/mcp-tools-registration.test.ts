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

  it('registers hitl_ask with timeout and default-answer guidance', async () => {
    const runtime = await createRuntime();
    const hitlAsk = (runtime.server as any).registrations.tools.get('hitl_ask');

    expect(hitlAsk.config.description).toContain('default_answer');
    expect(hitlAsk.config.description).toContain('900 seconds');
    expect(hitlAsk.config.description).toContain('single_choice');
    expect(hitlAsk.config.description).toContain('options[].value');
    expect(hitlAsk.config.description).toContain('multi_choice');
  });
});
