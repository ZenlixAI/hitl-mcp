import { describe, it, expect } from 'vitest';
import { askQuestionGroupInputSchema, askQuestionsInputSchema } from '../../src/domain/schemas.js';

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
    const parsed = askQuestionsInputSchema.safeParse({
      question_group_id: 'qg_bad',
      title: 'group',
      questions: [{ type: 'boolean', title: 'approve?' }]
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects caller-supplied question_id in ask schema', () => {
    const parsed = askQuestionsInputSchema.safeParse({
      title: 'group',
      questions: [{ question_id: 'q_bad', type: 'boolean', title: 'approve?' }]
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts ask schema without question_id', () => {
    const parsed = askQuestionsInputSchema.safeParse({
      title: 'group',
      questions: [{ type: 'boolean', title: 'approve?' }]
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts timeout_seconds and default_answer in ask schema', () => {
    const parsed = askQuestionsInputSchema.safeParse({
      title: 'group',
      timeout_seconds: 900,
      questions: [
        {
          type: 'single_choice',
          title: 'approve?',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ],
          default_answer: { value: 'no' }
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects non-positive timeout_seconds in ask schema', () => {
    const parsed = askQuestionsInputSchema.safeParse({
      title: 'group',
      timeout_seconds: 0,
      questions: [{ type: 'boolean', title: 'approve?' }]
    });

    expect(parsed.success).toBe(false);
  });
});
