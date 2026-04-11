import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server.js';

describe('idempotency', () => {
  it('returns same result for duplicated submit idempotency key', async () => {
    const { repository } = await createRuntime();

    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-idem-1',
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
    const questionId = String(created.questions[0].question_id);

    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-idem-1'
    };

    const first = await repository.submitAnswers(
      caller,
      { [questionId]: { value: 'A' } },
      [],
      'idem-1'
    );

    const second = await repository.submitAnswers(
      caller,
      { [questionId]: { value: 'B' } },
      [],
      'idem-1'
    );

    expect(second).toEqual(first);
  });
});
