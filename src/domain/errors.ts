export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'AGENT_IDENTITY_REQUIRED'
      | 'AGENT_SESSION_ID_REQUIRED'
      | 'PENDING_GROUP_ALREADY_EXISTS'
      | 'PENDING_GROUP_NOT_FOUND'
      | 'QUESTION_GROUP_NOT_FOUND',
    message: string
  ) {
    super(message);
  }
}
