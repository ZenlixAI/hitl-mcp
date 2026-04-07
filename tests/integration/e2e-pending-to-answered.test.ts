import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('e2e pending to answered', () => {
  it('asks questions, waits, then resolves after staged submissions', async () => {
    const { app, service } = await createRuntime();

    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-e2e-1'
    };

    const created = await service.askQuestions({
      caller,
      input: {
        title: 'Need user decision',
        questions: [
          {
            question_id: 'q_1',
            type: 'single_choice',
            title: 'Pick one',
            options: [
              { value: 'A', label: 'Option A' },
              { value: 'B', label: 'Option B' }
            ]
          },
          {
            question_id: 'q_2',
            type: 'boolean',
            title: 'Confirm?'
          }
        ]
      }
    });
    expect(created).toHaveLength(2);

    const waitPromise = service.wait({ caller });

    const pendingCheck = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);

    expect(pendingCheck).toBe('pending');

    const partialRes = await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-e2e-1'
      },
      body: JSON.stringify({
        answers: {
          q_1: { value: 'A' }
        }
      })
    });

    expect(partialRes.status).toBe(200);

    const stillPending = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);
    expect(stillPending).toBe('pending');

    const finalizeRes = await app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-e2e-1'
      },
      body: JSON.stringify({
        answers: {
          q_2: { value: true }
        }
      })
    });

    expect(finalizeRes.status).toBe(200);

    const finalPayload = await waitPromise;
    expect(finalPayload.status).toBe('completed');
    expect(finalPayload.is_terminal).toBe(true);
    expect(finalPayload.answered_question_ids.sort()).toEqual(['q_1', 'q_2']);
  });
});
