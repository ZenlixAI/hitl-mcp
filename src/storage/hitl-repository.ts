export interface FinalizeResult {
  status: 'answered';
  answered_question_ids: string[];
  answered_at: string;
}

export interface HitlRepository {
  isReady?(): Promise<boolean>;
  createPendingGroup(input: unknown): Promise<void>;
  getGroup(groupId: string): Promise<Record<string, unknown> | null>;
  getQuestion(questionId: string): Promise<Record<string, unknown> | null>;
  getGroupStatus(groupId: string): Promise<Record<string, unknown> | null>;
  finalizeAnswers(groupId: string, answers: Record<string, unknown>, idempotencyKey?: string): Promise<FinalizeResult>;
  cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }>;
  expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }>;
}
