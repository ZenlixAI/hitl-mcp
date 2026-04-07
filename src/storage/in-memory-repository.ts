import { randomUUID } from 'node:crypto';
import type { ScopedQuestionGroup } from '../domain/types';
import { transitionStatus } from '../state/status-machine';
import type { CreatePendingGroupInput, FinalizeResult, HitlRepository } from './hitl-repository';

export class InMemoryHitlRepository implements HitlRepository {
  private groups = new Map<string, ScopedQuestionGroup>();
  private pendingByScope = new Map<string, string>();
  private createIdempotency = new Map<string, string>();
  private finalizeIdempotency = new Map<string, FinalizeResult>();

  private scopeKey(agentIdentity: string, agentSessionId: string) {
    return `${agentIdentity}::${agentSessionId}`;
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup> {
    const scopeKey = this.scopeKey(input.agent_identity, input.agent_session_id);
    const idemKey = input.idempotency_key ? `${scopeKey}::${input.idempotency_key}` : null;

    if (idemKey) {
      const existingId = this.createIdempotency.get(idemKey);
      if (existingId) {
        return this.groups.get(existingId)!;
      }
    }

    const pendingId = this.pendingByScope.get(scopeKey);
    if (pendingId) {
      throw new Error('PENDING_GROUP_ALREADY_EXISTS');
    }

    const now = new Date().toISOString();
    const group: ScopedQuestionGroup = {
      agent_identity: input.agent_identity,
      agent_session_id: input.agent_session_id,
      question_group_id: `qg_${randomUUID()}`,
      title: input.title,
      description: input.description,
      questions: input.questions,
      status: 'pending',
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
      extra: input.extra
    };

    this.groups.set(group.question_group_id, group);
    this.pendingByScope.set(scopeKey, group.question_group_id);
    if (idemKey) {
      this.createIdempotency.set(idemKey, group.question_group_id);
    }

    return group;
  }

  async getGroup(groupId: string): Promise<ScopedQuestionGroup | null> {
    return this.groups.get(groupId) ?? null;
  }

  async getPendingGroupByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<ScopedQuestionGroup | null> {
    const groupId = this.pendingByScope.get(this.scopeKey(agentIdentity, agentSessionId));
    return groupId ? (this.groups.get(groupId) ?? null) : null;
  }

  async getGroupByCreateIdempotency(
    agentIdentity: string,
    agentSessionId: string,
    idempotencyKey: string
  ): Promise<ScopedQuestionGroup | null> {
    const groupId = this.createIdempotency.get(this.scopeKey(agentIdentity, agentSessionId) + `::${idempotencyKey}`);
    return groupId ? (this.groups.get(groupId) ?? null) : null;
  }

  async getQuestion(questionId: string): Promise<Record<string, unknown> | null> {
    for (const group of this.groups.values()) {
      const question = group.questions.find((item: Record<string, unknown>) => item.question_id === questionId);
      if (question) return question;
    }
    return null;
  }

  async getGroupStatus(groupId: string): Promise<Record<string, unknown> | null> {
    const group = this.groups.get(groupId);
    if (!group) return null;
    return {
      question_group_id: group.question_group_id,
      status: group.status,
      updated_at: group.updated_at
    };
  }

  async finalizeAnswers(
    groupId: string,
    answers: Record<string, unknown>,
    skippedQuestionIds: string[] = [],
    idempotencyKey?: string
  ): Promise<FinalizeResult> {
    if (idempotencyKey) {
      const cached = this.finalizeIdempotency.get(idempotencyKey);
      if (cached) return cached;
    }

    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'answered');

    const answeredAt = new Date().toISOString();
    group.status = 'answered';
    group.answers = answers;
    group.skipped_question_ids = skippedQuestionIds;
    group.updated_at = answeredAt;
    this.pendingByScope.delete(this.scopeKey(group.agent_identity, group.agent_session_id));

    const result: FinalizeResult = {
      status: 'answered',
      answered_question_ids: Object.keys(answers),
      skipped_question_ids: skippedQuestionIds,
      answered_at: answeredAt
    };

    if (idempotencyKey) {
      this.finalizeIdempotency.set(idempotencyKey, result);
    }

    return result;
  }

  async cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'cancelled');
    group.status = 'cancelled';
    group.updated_at = new Date().toISOString();
    this.pendingByScope.delete(this.scopeKey(group.agent_identity, group.agent_session_id));
    return { status: 'cancelled', reason };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'expired');
    group.status = 'expired';
    group.updated_at = new Date().toISOString();
    this.pendingByScope.delete(this.scopeKey(group.agent_identity, group.agent_session_id));
    return { status: 'expired', reason };
  }
}
