import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('ask and wait flow', () => {
  afterEach(() => {
    delete process.env.HITL_WAIT_MODE;
  });

  it('isolates wait by session id', async () => {
    process.env.HITL_WAIT_MODE = 'terminal_only';
    const { service, app } = await createRuntime();

    const callerA = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-scope-a'
    };
    const callerB = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-scope-b'
    };

    await service.askQuestions({
      caller: callerA,
      input: {
        title: 'A',
        questions: [{ type: 'boolean', title: 'Approve A?' }]
      }
    });
    await service.askQuestions({
      caller: callerB,
      input: {
        title: 'B',
        questions: [{ type: 'boolean', title: 'Approve B?' }]
      }
    });

    const pendingA = await service.getPendingQuestions(callerA);
    const pendingB = await service.getPendingQuestions(callerB);
    const questionIdA = String(pendingA[0].question_id);
    const questionIdB = String(pendingB[0].question_id);

    const waitA = service.wait({ caller: callerA });

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': callerB.agent_identity,
        'x-agent-session-id': callerB.agent_session_id
      },
      body: JSON.stringify({
        answers: { [questionIdB]: { value: true } }
      })
    });

    const stillPending = await Promise.race([
      waitA.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(stillPending).toBe('pending');

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': callerA.agent_identity,
        'x-agent-session-id': callerA.agent_session_id
      },
      body: JSON.stringify({
        answers: { [questionIdA]: { value: false } }
      })
    });

    const resultA = await waitA;
    expect(resultA.status).toBe('completed');
    expect(resultA.changed_question_ids).toEqual([questionIdA]);
    expect(resultA.answered_question_ids).toEqual([questionIdA]);
  });

  it('treats skip and cancel as resolved but waits until no pending questions remain', async () => {
    process.env.HITL_WAIT_MODE = 'terminal_only';
    const { service, app } = await createRuntime();

    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-terminal-semantics-1'
    };

    const created = await service.askQuestions({
      caller,
      input: {
        title: 'Terminal semantics',
        questions: [
          { type: 'boolean', title: 'required', required: true },
          { type: 'text', title: 'optional-skip', required: false },
          { type: 'text', title: 'optional-cancel', required: false }
        ]
      }
    });

    const requiredQuestionId = String(created[0].question_id);
    const optionalSkipId = String(created[1].question_id);
    const optionalCancelId = String(created[2].question_id);

    const waitPromise = service.waitForQuestionIds({
      caller,
      questionIds: [requiredQuestionId, optionalSkipId, optionalCancelId]
    });

    const skipRes = await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        skipped_question_ids: [optionalSkipId]
      })
    });
    const skipBody = await skipRes.json();
    expect(skipBody.data.status).toBe('in_progress');

    const afterSkip = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(afterSkip).toBe('pending');

    const cancelRes = await app.request('/api/v1/questions/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        question_ids: [optionalCancelId]
      })
    });
    const cancelBody = await cancelRes.json();
    expect(cancelBody.data.status).toBe('cancelled');

    const afterCancel = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(afterCancel).toBe('pending');

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [requiredQuestionId]: { value: true } }
      })
    });

    const result = await waitPromise;
    expect(result.status).toBe('completed');
    expect(result.is_terminal).toBe(true);
    expect(result.pending_questions).toEqual([]);
    expect(result.answered_question_ids).toEqual([requiredQuestionId]);
    expect(result.skipped_question_ids).toEqual([optionalSkipId]);
    expect(result.cancelled_question_ids).toEqual([optionalCancelId]);
  });
});
