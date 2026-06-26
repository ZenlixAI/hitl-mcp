import { describe, expect, it } from 'vitest';
import { deriveDefaultAnswer, resolveDefaultAnswer, validateQuestionDefaultAnswer } from '../../src/domain/default-answer.js';

describe('default answer derivation', () => {
  it('derives the first single choice option', () => {
    expect(
      deriveDefaultAnswer({
        question_id: 'q_1',
        type: 'single_choice',
        title: 'Pick one',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' }
        ],
        required: true
      }).value
    ).toBe('A');
  });

  it('derives true for boolean questions', () => {
    expect(
      deriveDefaultAnswer({
        question_id: 'q_1',
        type: 'boolean',
        title: 'Confirm?',
        required: true
      }).value
    ).toBe(true);
  });

  it('rejects invalid explicit default answers', () => {
    const result = validateQuestionDefaultAnswer(
      {
        question_id: 'q_1',
        type: 'range',
        title: 'Score',
        range_constraints: { min: 0, max: 10 },
        required: true
      },
      { value: 99 }
    );

    expect(result.ok).toBe(false);
  });

  it('rejects single_choice default answers that are not option values with a clear error', () => {
    expect(() =>
      resolveDefaultAnswer(
        {
          question_id: 'q_1',
          type: 'single_choice',
          title: 'Mood',
          options: [
            { value: 'happy', label: 'Happy' },
            { value: 'neutral', label: 'Neutral' }
          ],
          required: true
        },
        { value: false }
      )
    ).toThrow(/single_choice/i);
  });

  it('rejects multi_choice default answers that contain non-option values', () => {
    const result = validateQuestionDefaultAnswer(
      {
        question_id: 'q_1',
        type: 'multi_choice',
        title: 'Tags',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' }
        ],
        required: true
      },
      { value: ['x'] }
    );

    expect(result.ok).toBe(false);
  });
});
