import { DomainError } from './errors.js';
import { validateAnswerSet, type ValidationResult } from './validators.js';
import type { Question } from './types.js';

export type AnswerValue = { value: unknown };

export function deriveDefaultAnswer(question: Question): AnswerValue {
  if (question.type === 'single_choice') return { value: question.options[0].value };
  if (question.type === 'multi_choice') return { value: [question.options[0].value] };
  if (question.type === 'text') return { value: 'none' };
  if (question.type === 'boolean') return { value: true };
  return { value: question.range_constraints.min };
}

export function validateQuestionDefaultAnswer(
  question: Question,
  answer: AnswerValue
): ValidationResult {
  return validateAnswerSet([question], { [question.question_id]: answer });
}

export function resolveDefaultAnswer(question: Question, explicit?: AnswerValue): AnswerValue {
  const resolved = explicit ?? deriveDefaultAnswer(question);
  const validation = validateQuestionDefaultAnswer(question, resolved);
  if (!validation.ok) {
    throw new DomainError('ANSWER_VALIDATION_FAILED', 'invalid default answer');
  }
  return resolved;
}
