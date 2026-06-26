import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('mcp wait progress notifications', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.HITL_STORAGE;
  });

  it('reports progress every 30 seconds while waiting', async () => {
    vi.useFakeTimers();

    const runtime = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-progress-wait'
    };

    await runtime.service.askQuestions({
      caller,
      input: {
        title: 'Progress wait',
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const hitlWait = (runtime.server as any).registrations.tools.get('hitl_wait');
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    const waitPromise = hitlWait.handler(
      {},
      {
        state: new Map([
          ['agentIdentity', caller.agent_identity],
          ['agentSessionId', caller.agent_session_id]
        ]),
        reportProgress
      }
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(reportProgress).toHaveBeenCalledWith(
      30,
      undefined,
      expect.stringContaining('Waiting')
    );

    const pendingQuestions = await runtime.service.getPendingQuestions(caller);
    const questionId = String(pendingQuestions[0].question_id);

    await runtime.service.submitAnswers({
      caller,
      input: {
        answers: {
          [questionId]: { value: true }
        }
      }
    });

    await waitPromise;
  });

  it('logs a structured event after successfully sending progress', async () => {
    vi.useFakeTimers();

    const runtime = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-progress-log-success'
    };

    await runtime.service.askQuestions({
      caller,
      input: {
        title: 'Progress log success',
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const hitlWait = (runtime.server as any).registrations.tools.get('hitl_wait');
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    const waitPromise = hitlWait.handler(
      {},
      {
        state: new Map([
          ['agentIdentity', caller.agent_identity],
          ['agentSessionId', caller.agent_session_id]
        ]),
        reportProgress
      }
    );

    await vi.advanceTimersByTimeAsync(30_000);

    const progressLog = consoleLogSpy.mock.calls
      .map(([entry]) => String(entry))
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.message === 'mcp_wait_progress_sent');

    expect(progressLog).toMatchObject({
      level: 'info',
      message: 'mcp_wait_progress_sent',
      tool_name: 'hitl_wait',
      agent_identity: caller.agent_identity,
      agent_session_id: caller.agent_session_id,
      progress: 30,
      elapsed_seconds: 30,
      progress_message: 'Waiting for human input'
    });

    const pendingQuestions = await runtime.service.getPendingQuestions(caller);
    const questionId = String(pendingQuestions[0].question_id);

    await runtime.service.submitAnswers({
      caller,
      input: {
        answers: {
          [questionId]: { value: true }
        }
      }
    });

    await waitPromise;
  });

  it('logs a warning instead of a success event when progress sending fails', async () => {
    vi.useFakeTimers();

    const runtime = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-progress-log-failure'
    };

    await runtime.service.askQuestions({
      caller,
      input: {
        title: 'Progress log failure',
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const hitlWait = (runtime.server as any).registrations.tools.get('hitl_wait');
    const reportProgress = vi.fn().mockRejectedValue(new Error('progress failed'));

    const waitPromise = hitlWait.handler(
      {},
      {
        state: new Map([
          ['agentIdentity', caller.agent_identity],
          ['agentSessionId', caller.agent_session_id]
        ]),
        reportProgress
      }
    );

    await vi.advanceTimersByTimeAsync(30_000);

    const logs = consoleLogSpy.mock.calls
      .map(([entry]) => String(entry))
      .map((entry) => JSON.parse(entry));

    expect(logs.find((entry) => entry.message === 'mcp_wait_progress_sent')).toBeUndefined();
    expect(logs.find((entry) => entry.message === 'mcp_wait_progress_failed')).toMatchObject({
      level: 'warn',
      tool_name: 'hitl_wait',
      agent_identity: caller.agent_identity,
      agent_session_id: caller.agent_session_id,
      progress: 30,
      elapsed_seconds: 30,
      progress_message: 'Waiting for human input'
    });

    const pendingQuestions = await runtime.service.getPendingQuestions(caller);
    const questionId = String(pendingQuestions[0].question_id);

    await runtime.service.submitAnswers({
      caller,
      input: {
        answers: {
          [questionId]: { value: true }
        }
      }
    });

    await waitPromise;
  });
});
