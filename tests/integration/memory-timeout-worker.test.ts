import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('memory timeout worker', () => {
  afterEach(() => {
    delete process.env.HITL_STORAGE;
    delete process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS;
    delete process.env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS;
    delete process.env.HITL_WAIT_MODE;
  });

  it('auto-responds in memory mode using the configured default timeout', async () => {
    process.env.HITL_STORAGE = 'memory';
    process.env.HITL_WAIT_MODE = 'terminal_only';
    process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '1';
    process.env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS = '1';

    const { service } = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-memory-default-timeout'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Memory timeout default',
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const result = await service.wait({ caller });

    expect(result.status).toBe('completed');
    expect(result.is_terminal).toBe(true);
    expect(result.resolved_questions).toHaveLength(1);
    expect(result.resolved_questions[0]).toEqual(
      expect.objectContaining({
        status: 'answered',
        answer: { value: true }
      })
    );
    expect(result.resolved_questions[0].question).toEqual(
      expect.objectContaining({
        is_timeout_auto_response: true
      })
    );
  }, 5000);
});
