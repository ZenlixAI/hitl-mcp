import { describe, it, expect } from 'vitest';
import { askQuestionGroupInputSchema, createQuestionGroupInputSchema } from '../../src/domain/schemas';

describe('domain schemas', () => {
  it('rejects single_choice without options', () => {
    const parsed = askQuestionGroupInputSchema.safeParse({
      question_group_id: 'qg_1',
      title: 'group',
      questions: [{ question_id: 'q_1', type: 'single_choice', title: 'pick one' }]
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects caller-supplied question_group_id in create schema', () => {
    const parsed = createQuestionGroupInputSchema.safeParse({
      question_group_id: 'qg_bad',
      title: 'group',
      questions: [{ question_id: 'q_1', type: 'boolean', title: 'approve?' }]
    });

    expect(parsed.success).toBe(false);
  });
});
