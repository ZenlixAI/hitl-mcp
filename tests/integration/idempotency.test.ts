import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('idempotency', () => {
  it('returns same result for duplicated finalize idempotency key', async () => {
    const { repository } = await createRuntime();

    await repository.createPendingGroup({
      question_group_id: 'qg_idem_1',
      title: 'group',
      questions: [
        {
          question_id: 'q_1',
          type: 'single_choice',
          title: 'Pick one',
          options: [
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' }
          ]
        }
      ]
    });

    const first = await repository.finalizeAnswers(
      'qg_idem_1',
      { q_1: { value: 'A' } },
      'idem-1'
    );

    const second = await repository.finalizeAnswers(
      'qg_idem_1',
      { q_1: { value: 'B' } },
      'idem-1'
    );

    expect(second).toEqual(first);
  });
});
