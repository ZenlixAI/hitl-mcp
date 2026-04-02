import { describe, it, expect } from 'vitest';
import { validateAnswerSet } from '../../src/domain/validators';

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
});
