import type { ScopedQuestionGroup } from '../domain/types';

export interface FinalizeResult {
  status: 'answered';
  answered_question_ids: string[];
  answered_at: string;
}

export interface CreatePendingGroupInput {
  agent_identity: string;
  agent_session_id: string;
  title: string;
  description?: string;
  ttl_seconds?: number;
  questions: Array<Record<string, unknown>>;
  idempotency_key?: string;
  extra?: Record<string, unknown>;
}

export interface HitlRepository {
  isReady?(): Promise<boolean>;
  createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup>;
  getGroup(groupId: string): Promise<ScopedQuestionGroup | null>;
  getPendingGroupByScope(agentIdentity: string, agentSessionId: string): Promise<ScopedQuestionGroup | null>;
  getGroupByCreateIdempotency(
    agentIdentity: string,
    agentSessionId: string,
    idempotencyKey: string
  ): Promise<ScopedQuestionGroup | null>;
  getQuestion(questionId: string): Promise<Record<string, unknown> | null>;
  getGroupStatus(groupId: string): Promise<Record<string, unknown> | null>;
  finalizeAnswers(groupId: string, answers: Record<string, unknown>, idempotencyKey?: string): Promise<FinalizeResult>;
  cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }>;
  expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }>;
}
