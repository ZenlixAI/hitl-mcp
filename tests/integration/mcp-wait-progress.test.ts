import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('mcp wait progress notifications', () => {
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
});
