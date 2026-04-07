export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'AGENT_IDENTITY_REQUIRED'
      | 'AGENT_SESSION_ID_REQUIRED'
      | 'PENDING_REQUEST_ALREADY_EXISTS'
      | 'PENDING_REQUEST_NOT_FOUND'
      | 'REQUEST_NOT_FOUND',
    message: string
  ) {
    super(message);
  }
}
