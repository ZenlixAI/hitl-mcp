export type ErrorCode =
  | 'QUESTION_GROUP_NOT_FOUND'
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_GROUP_NOT_PENDING'
  | 'ANSWER_VALIDATION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export class HitlError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}
