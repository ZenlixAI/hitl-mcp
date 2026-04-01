import { describe, it, expect } from 'vitest';
import { askQuestionGroupInputSchema } from '../../src/domain/schemas';

describe('domain schemas', () => {
  it('rejects single_choice without options', () => {
    const parsed = askQuestionGroupInputSchema.safeParse({
      question_group_id: 'qg_1',
      title: 'group',
      questions: [{ question_id: 'q_1', type: 'single_choice', title: 'pick one' }]
    });

    expect(parsed.success).toBe(false);
  });
});
