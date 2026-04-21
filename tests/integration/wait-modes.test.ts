import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('wait modes', () => {
  afterEach(() => {
    delete process.env.HITL_WAIT_MODE;
  });

  it('terminal_only waits until all pending questions are resolved', async () => {
    process.env.HITL_WAIT_MODE = 'terminal_only';
    const { service, app } = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-wait-terminal'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Terminal wait',
        questions: [
          { type: 'boolean', title: 'First?' },
          { type: 'boolean', title: 'Second?' }
        ]
      }
    });
    const pendingQuestions = await service.getPendingQuestions(caller);
    const firstQuestionId = String(pendingQuestions[0].question_id);
    const secondQuestionId = String(pendingQuestions[1].question_id);

    const waitPromise = service.wait({ caller });

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [firstQuestionId]: { value: true } }
      })
    });

    const pending = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(pending).toBe('pending');

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [secondQuestionId]: { value: false } }
      })
    });

    const result = await waitPromise;
    expect(result.status).toBe('completed');
    expect(result.is_terminal).toBe(true);
  });

  it('progressive returns after each state change', async () => {
    process.env.HITL_WAIT_MODE = 'progressive';
    const { service, app } = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-wait-progressive'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Progressive wait',
        questions: [
          { type: 'boolean', title: 'First?' },
          { type: 'boolean', title: 'Second?' }
        ]
      }
    });
    const pendingQuestions = await service.getPendingQuestions(caller);
    const firstQuestionId = String(pendingQuestions[0].question_id);
    const secondQuestionId = String(pendingQuestions[1].question_id);

    const firstWait = service.wait({ caller });
    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [firstQuestionId]: { value: true } }
      })
    });

    const firstEvent = await firstWait;
    expect(firstEvent.status).toBe('in_progress');
    expect(firstEvent.is_terminal).toBe(false);
    expect(firstEvent.changed_question_ids).toEqual([firstQuestionId]);
    expect(firstEvent.resolved_questions).toEqual([
      {
        question: expect.objectContaining({
          question_id: firstQuestionId,
          title: 'First?',
          type: 'boolean',
          status: 'answered',
          answer: { value: true }
        }),
        status: 'answered',
        answer: { value: true }
      }
    ]);

    const secondWait = service.wait({ caller });
    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [secondQuestionId]: { value: false } }
      })
    });

    const secondEvent = await secondWait;
    expect(secondEvent.status).toBe('completed');
    expect(secondEvent.is_terminal).toBe(true);
    expect(secondEvent.changed_question_ids).toEqual([secondQuestionId]);
    expect(secondEvent.answered_question_ids).toEqual([secondQuestionId]);
    expect(secondEvent.resolved_questions).toEqual([
      {
        question: expect.objectContaining({
          question_id: secondQuestionId,
          title: 'Second?',
          type: 'boolean',
          status: 'answered',
          answer: { value: false }
        }),
        status: 'answered',
        answer: { value: false }
      }
    ]);
  });

  it('can wait only for the questions created by the current ask flow', async () => {
    process.env.HITL_WAIT_MODE = 'progressive';
    const { service, app } = await createRuntime();
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-wait-targeted'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Existing pending',
        questions: [
          { type: 'boolean', title: 'Old?' }
        ]
      }
    });
    const initialPending = await service.getPendingQuestions(caller);
    const oldQuestionId = String(initialPending[0].question_id);

    const created = await service.askQuestions({
      caller,
      input: {
        title: 'Current ask',
        questions: [
          { type: 'boolean', title: 'New?' }
        ]
      }
    });
    const newQuestionId = String(created[0].question_id);

    const targetedWait = service.waitForQuestionIds({
      caller,
      questionIds: [newQuestionId]
    });

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [oldQuestionId]: { value: true } }
      })
    });

    const stillPending = await Promise.race([
      targetedWait.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(stillPending).toBe('pending');

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { [newQuestionId]: { value: false } }
      })
    });

    const result = await targetedWait;
    expect(result.changed_question_ids).toEqual([newQuestionId]);
    expect(result.answered_question_ids).toEqual([newQuestionId]);
    expect(result.resolved_questions).toEqual([
      {
        question: expect.objectContaining({
          question_id: newQuestionId,
          title: 'New?',
          type: 'boolean',
          status: 'answered',
          answer: { value: false }
        }),
        status: 'answered',
        answer: { value: false }
      }
    ]);
  });
});
