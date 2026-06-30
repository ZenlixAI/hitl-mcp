import { describe, it, expect } from 'vitest';
import {
  askQuestionGroupInputSchema,
  askQuestionsInputSchema,
  submitAnswersInputSchema
} from '../../src/domain/schemas.js';

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

  it('accepts single_choice followup_fields in ask schema', () => {
    const parsed = askQuestionsInputSchema.safeParse({
      title: 'outline confirmation',
      questions: [
        {
          type: 'single_choice',
          title: 'confirm outline',
          options: [
            { value: 'approved', label: 'Approved' },
            {
              value: 'revise',
              label: 'Revise',
              followup_fields: [
                {
                  id: 'comment',
                  type: 'text',
                  label: 'Revision comment',
                  required: true,
                  description: 'Explain what should change.'
                }
              ]
            }
          ]
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts submit answers with value only or value plus fields', () => {
    const parsed = submitAnswersInputSchema.safeParse({
      answers: {
        q_approved: { value: 'approved' },
        q_revise: {
          value: 'revise',
          fields: {
            comment: 'Please add recovery conditions.'
          }
        }
      }
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects legacy feedback in submit answers schema', () => {
    const parsed = submitAnswersInputSchema.safeParse({
      answers: {
        q_revise: {
          value: 'revise',
          feedback: {
            comment: 'legacy field'
          }
        }
      }
    });

    expect(parsed.success).toBe(false);
  });

  it('documents per-type default_answer guidance in the question schema', () => {
    const shape = (askQuestionsInputSchema.shape.questions as any)._def.element.options;
    const singleChoiceSchema = shape.find((option: any) => option.shape.type.value === 'single_choice');
    const multiChoiceSchema = shape.find((option: any) => option.shape.type.value === 'multi_choice');
    const singleChoiceDescription = singleChoiceSchema.shape.default_answer.unwrap().description;
    const multiChoiceDescription = multiChoiceSchema.shape.default_answer.unwrap().description;

    expect(singleChoiceDescription).toContain('options[].value');
    expect(singleChoiceDescription).toContain('single_choice');
    expect(multiChoiceDescription).toContain('string[]');
    expect(multiChoiceDescription).toContain('options[].value');
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
