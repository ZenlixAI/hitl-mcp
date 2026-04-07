export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'AGENT_IDENTITY_REQUIRED'
      | 'AGENT_SESSION_ID_REQUIRED'
      | 'PENDING_QUESTIONS_NOT_FOUND'
      | 'QUESTION_NOT_FOUND'
      | 'ANSWER_VALIDATION_FAILED',
    message: string
  ) {
    super(message);
  }
}
