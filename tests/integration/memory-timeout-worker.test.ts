import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('memory timeout worker', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    consoleLogSpy.mockClear();
  });

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

    const logs = consoleLogSpy.mock.calls
      .map(([entry]) => String(entry))
      .map((entry) => JSON.parse(entry));

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
    expect(logs.find((entry) => entry.message === 'memory_timeout_group_processed')).toMatchObject({
      level: 'info',
      group_id: expect.any(String),
      scope_key: `${caller.agent_identity}::${caller.agent_session_id}`,
      changed_question_ids: [expect.any(String)],
      pending_question_count: 0,
      resolved_question_count: 1,
      is_complete: true
    });
    expect(logs.find((entry) => entry.message === 'wait_completed')).toMatchObject({
      level: 'info',
      agent_identity: caller.agent_identity,
      agent_session_id: caller.agent_session_id,
      status: 'completed',
      is_terminal: true,
      pending_question_count: 0,
      resolved_question_count: 1,
      answered_question_count: 1
    });
  }, 5000);
});
