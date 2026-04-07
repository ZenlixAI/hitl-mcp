import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

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
          { question_id: 'q_terminal_1', type: 'boolean', title: 'First?' },
          { question_id: 'q_terminal_2', type: 'boolean', title: 'Second?' }
        ]
      }
    });

    const waitPromise = service.wait({ caller });

    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { q_terminal_1: { value: true } }
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
        answers: { q_terminal_2: { value: false } }
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
          { question_id: 'q_progressive_1', type: 'boolean', title: 'First?' },
          { question_id: 'q_progressive_2', type: 'boolean', title: 'Second?' }
        ]
      }
    });

    const firstWait = service.wait({ caller });
    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { q_progressive_1: { value: true } }
      })
    });

    const firstEvent = await firstWait;
    expect(firstEvent.status).toBe('in_progress');
    expect(firstEvent.is_terminal).toBe(false);
    expect(firstEvent.changed_question_ids).toEqual(['q_progressive_1']);

    const secondWait = service.wait({ caller });
    await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': caller.agent_identity,
        'x-agent-session-id': caller.agent_session_id
      },
      body: JSON.stringify({
        answers: { q_progressive_2: { value: false } }
      })
    });

    const secondEvent = await secondWait;
    expect(secondEvent.status).toBe('completed');
    expect(secondEvent.is_terminal).toBe(true);
    expect(secondEvent.changed_question_ids).toEqual(['q_progressive_2']);
  });
});
