import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('e2e pending to answered', () => {
  it('creates pending group, waits, then resolves after finalize', async () => {
    const { app, service } = await createRuntime();

    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-e2e-1'
    };

    const created = await service.createQuestionGroup({
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
          }
        ]
      }
    });
    expect(created.status).toBe('pending');

    const waitPromise = service.waitQuestionGroup({
      caller,
      question_group_id: created.question_group_id
    });

    const pendingCheck = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);

    expect(pendingCheck).toBe('pending');

    const finalizeRes = await app.request(`/api/v1/question-groups/${created.question_group_id}/answers/finalize`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: {
          q_1: { value: 'A' }
        }
      })
    });

    expect(finalizeRes.status).toBe(200);

    const finalPayload = await waitPromise;
    expect(finalPayload.status).toBe('answered');
    expect((finalPayload.answers as Record<string, { value: string }>).q_1.value).toBe('A');
  });
});
