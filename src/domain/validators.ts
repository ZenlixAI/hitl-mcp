import type { Question } from './types';

export type ValidationError = {
  question_id: string;
  reason: string;
  expected: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export function validateAnswerSet(
  questions: Question[],
  answers: Record<string, { value: unknown }>
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const question of questions) {
    const answer = answers[question.question_id];

    if (!answer) {
      if (question.required !== false) {
        errors.push({
          question_id: question.question_id,
          reason: '必答题未回答',
          expected: 'value present'
        });
      }
      continue;
    }

    if (question.type === 'single_choice') {
      if (
        typeof answer.value !== 'string' ||
        !question.options.some((opt) => opt.value === answer.value)
      ) {
        errors.push({
          question_id: question.question_id,
          reason: '单选值非法',
          expected: 'one option value'
        });
      }
      continue;
    }

    if (question.type === 'multi_choice') {
      if (
        !Array.isArray(answer.value) ||
        answer.value.some((v) => typeof v !== 'string')
      ) {
        errors.push({
          question_id: question.question_id,
          reason: '多选格式错误',
          expected: 'string[]'
        });
      }
      continue;
    }

    if (question.type === 'text') {
      if (typeof answer.value !== 'string') {
        errors.push({
          question_id: question.question_id,
          reason: '文本格式错误',
          expected: 'string'
        });
      }
      continue;
    }

    if (question.type === 'boolean') {
      if (typeof answer.value !== 'boolean') {
        errors.push({
          question_id: question.question_id,
          reason: '判断题格式错误',
          expected: 'boolean'
        });
      }
      continue;
    }

    if (question.type === 'range') {
      if (typeof answer.value !== 'number') {
        errors.push({
          question_id: question.question_id,
          reason: '范围题格式错误',
          expected: 'number'
        });
        continue;
      }

      if (
        answer.value < question.range_constraints.min ||
        answer.value > question.range_constraints.max
      ) {
        errors.push({
          question_id: question.question_id,
          reason: '数值超出范围',
          expected: `${question.range_constraints.min} <= value <= ${question.range_constraints.max}`
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}
