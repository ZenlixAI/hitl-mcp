import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('e2e pending to answered', () => {
  it('keeps ask pending until finalize then resolves', async () => {
    const { app, service } = await createRuntime();

    const askPromise = service.askQuestionGroup({
      question_group_id: 'qg_e2e_1',
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
    });

    const pendingCheck = await Promise.race([
      askPromise.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 30))
    ]);

    expect(pendingCheck).toBe('pending');

    const finalizeRes = await app.request('/api/v1/question-groups/qg_e2e_1/answers/finalize', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: {
          q_1: { value: 'A' }
        }
      })
    });

    expect(finalizeRes.status).toBe(200);

    const finalPayload = await askPromise;
    expect(finalPayload.status).toBe('answered');
    expect((finalPayload.answers as Record<string, { value: string }>).q_1.value).toBe('A');
  });
});
