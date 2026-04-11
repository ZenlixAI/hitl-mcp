import { describe, it, expect } from 'vitest';
import { validateAnswerSet } from '../../src/domain/validators.js';

describe('answer validator', () => {
  it('returns readable errors for invalid range', () => {
    const result = validateAnswerSet(
      [
        {
          question_id: 'q_1',
          type: 'range',
          title: 'rate',
          required: true,
          range_constraints: { min: 0, max: 10, step: 1 }
        }
      ] as any,
      { q_1: { value: 99 } }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].reason).toContain('数值超出范围');
    }
  });

  it('allows optional questions to remain unanswered in a partial submission', () => {
    const result = validateAnswerSet(
      [
        {
          question_id: 'q_required',
          type: 'boolean',
          title: 'required',
          required: true
        },
        {
          question_id: 'q_optional',
          type: 'text',
          title: 'optional',
          required: false
        }
      ] as any,
      { q_required: { value: true } }
    );

    expect(result.ok).toBe(true);
  });

  it('accepts explicit skip for optional questions and rejects skip for required ones', () => {
    const valid = validateAnswerSet(
      [
        {
          question_id: 'q_required',
          type: 'boolean',
          title: 'required',
          required: true
        },
        {
          question_id: 'q_optional',
          type: 'text',
          title: 'optional',
          required: false
        }
      ] as any,
      { q_required: { value: false } },
      ['q_optional']
    );

    expect(valid.ok).toBe(true);

    const invalid = validateAnswerSet(
      [
        {
          question_id: 'q_required',
          type: 'boolean',
          title: 'required',
          required: true
        }
      ] as any,
      {},
      ['q_required']
    );

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors[0].reason).toContain('必答题不能忽略');
    }
  });
});
