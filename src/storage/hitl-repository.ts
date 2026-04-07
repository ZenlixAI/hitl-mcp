import type { CallerScope, ScopeQuestionSnapshot, ScopedQuestionGroup } from '../domain/types';

export interface FinalizeResult {
  status: 'answered' | 'in_progress';
  answered_question_ids: string[];
  skipped_question_ids: string[];
  cancelled_question_ids?: string[];
  pending_questions?: Array<Record<string, unknown>>;
  changed_question_ids?: string[];
  answered_at?: string;
  is_complete?: boolean;
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
  getPendingGroupsByScope(agentIdentity: string, agentSessionId: string): Promise<ScopedQuestionGroup[]>;
  getPendingQuestionsByScope(agentIdentity: string, agentSessionId: string): Promise<Array<Record<string, unknown>>>;
  getScopeSnapshot(caller: CallerScope, changedQuestionIds?: string[]): Promise<ScopeQuestionSnapshot>;
  getGroupByCreateIdempotency(
    agentIdentity: string,
    agentSessionId: string,
    idempotencyKey: string
  ): Promise<ScopedQuestionGroup | null>;
  getQuestion(questionId: string): Promise<Record<string, unknown> | null>;
  getGroupStatus(groupId: string): Promise<Record<string, unknown> | null>;
  submitAnswers(
    caller: CallerScope,
    answers: Record<string, unknown>,
    skippedQuestionIds?: string[],
    idempotencyKey?: string
  ): Promise<FinalizeResult>;
  cancelQuestions(
    caller: CallerScope,
    questionIds?: string[],
    cancelAll?: boolean,
    reason?: string
  ): Promise<ScopeQuestionSnapshot & { status: 'cancelled' }>;
  expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }>;
}
