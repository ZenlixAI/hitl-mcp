import { randomUUID } from 'node:crypto';
import type { CallerScope, ScopeQuestionSnapshot, ScopedQuestionGroup } from '../domain/types.js';
import { validateAnswerSet } from '../domain/validators.js';
import { transitionStatus } from '../state/status-machine.js';
import type { CreatePendingGroupInput, FinalizeResult, HitlRepository } from './hitl-repository.js';

export class InMemoryHitlRepository implements HitlRepository {
  private groups = new Map<string, ScopedQuestionGroup>();
  private pendingByScope = new Map<string, Set<string>>();
  private createIdempotency = new Map<string, string>();
  private finalizeIdempotency = new Map<string, FinalizeResult>();

  private scopeKey(agentIdentity: string, agentSessionId: string) {
    return `${agentIdentity}::${agentSessionId}`;
  }

  private publicQuestion(group: ScopedQuestionGroup, question: Record<string, unknown>) {
    return {
      ...question,
      group_id: undefined,
      status: (question.status as string | undefined) ?? 'pending'
    };
  }

  private resolvedQuestion(group: ScopedQuestionGroup, question: Record<string, unknown>) {
    const publicQuestion = this.publicQuestion(group, question);
    const status = String(publicQuestion.status ?? 'pending') as 'answered' | 'skipped' | 'cancelled';
    return {
      question: publicQuestion,
      status,
      ...(Object.prototype.hasOwnProperty.call(question, 'answer')
        ? { answer: question.answer }
        : {})
    };
  }

  private pendingSet(scopeKey: string) {
    const current = this.pendingByScope.get(scopeKey);
    if (current) return current;
    const next = new Set<string>();
    this.pendingByScope.set(scopeKey, next);
    return next;
  }

  private recomputeGroupStatus(group: ScopedQuestionGroup) {
    const questions = group.questions as Array<Record<string, unknown>>;
    const pending = questions.some((question) => question.status === 'pending');
    if (pending) {
      group.status = 'pending';
      return;
    }

    const cancelledOnly = questions.every((question) => question.status === 'cancelled');
    group.status = cancelledOnly ? 'cancelled' : 'answered';
  }

  private syncPendingScope(group: ScopedQuestionGroup) {
    const scopeKey = this.scopeKey(group.agent_identity, group.agent_session_id);
    const set = this.pendingSet(scopeKey);
    if (group.status === 'pending') set.add(group.question_group_id);
    else set.delete(group.question_group_id);
    if (set.size === 0) this.pendingByScope.delete(scopeKey);
  }

  private questionLookup(caller: CallerScope) {
    const groups = Array.from(this.groups.values()).filter(
      (group) =>
        group.agent_identity === caller.agent_identity &&
        group.agent_session_id === caller.agent_session_id
    );
    const lookup = new Map<string, { group: ScopedQuestionGroup; question: Record<string, unknown> }>();
    for (const group of groups) {
      for (const question of group.questions as Array<Record<string, unknown>>) {
        lookup.set(String(question.question_id), { group, question });
      }
    }
    return lookup;
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

    const now = new Date().toISOString();
    const group: ScopedQuestionGroup = {
      agent_identity: input.agent_identity,
      agent_session_id: input.agent_session_id,
      question_group_id: `qg_${randomUUID()}`,
      title: input.title,
      description: input.description,
      questions: input.questions.map((question) => ({
        ...question,
        question_id: `q_${randomUUID()}`,
        status: 'pending',
        created_at: now,
        updated_at: now
      })),
      status: 'pending',
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
      extra: input.extra
    };

    this.groups.set(group.question_group_id, group);
    this.pendingSet(scopeKey).add(group.question_group_id);
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
    const groupIds = this.pendingByScope.get(this.scopeKey(agentIdentity, agentSessionId));
    const firstId = groupIds ? Array.from(groupIds)[0] : null;
    return firstId ? (this.groups.get(firstId) ?? null) : null;
  }

  async getPendingGroupsByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<ScopedQuestionGroup[]> {
    const groupIds = this.pendingByScope.get(this.scopeKey(agentIdentity, agentSessionId));
    return groupIds ? Array.from(groupIds).map((id) => this.groups.get(id)!).filter(Boolean) : [];
  }

  async getPendingQuestionsByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<Array<Record<string, unknown>>> {
    const groups = await this.getPendingGroupsByScope(agentIdentity, agentSessionId);
    return groups.flatMap((group) =>
      (group.questions as Array<Record<string, unknown>>)
        .filter((question) => question.status === 'pending')
        .map((question) => this.publicQuestion(group, question))
    );
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
      if (question) return this.publicQuestion(group, question);
    }
    return null;
  }

  async getScopeSnapshot(
    caller: CallerScope,
    changedQuestionIds: string[] = []
  ): Promise<ScopeQuestionSnapshot> {
    const groups = Array.from(this.groups.values()).filter(
      (group) =>
        group.agent_identity === caller.agent_identity &&
        group.agent_session_id === caller.agent_session_id
    );
    const pendingQuestions: Array<Record<string, unknown>> = [];
    const resolvedQuestions: ScopeQuestionSnapshot['resolved_questions'] = [];
    const answeredQuestionIds: string[] = [];
    const skippedQuestionIds: string[] = [];
    const cancelledQuestionIds: string[] = [];

    for (const group of groups) {
      for (const question of group.questions as Array<Record<string, unknown>>) {
        const status = question.status as string;
        if (status === 'pending') pendingQuestions.push(this.publicQuestion(group, question));
        if (status === 'answered') {
          answeredQuestionIds.push(String(question.question_id));
          resolvedQuestions.push(this.resolvedQuestion(group, question));
        }
        if (status === 'skipped') {
          skippedQuestionIds.push(String(question.question_id));
          resolvedQuestions.push(this.resolvedQuestion(group, question));
        }
        if (status === 'cancelled') {
          cancelledQuestionIds.push(String(question.question_id));
          resolvedQuestions.push(this.resolvedQuestion(group, question));
        }
      }
    }

    return {
      pending_questions: pendingQuestions,
      resolved_questions: resolvedQuestions,
      answered_question_ids: answeredQuestionIds,
      skipped_question_ids: skippedQuestionIds,
      cancelled_question_ids: cancelledQuestionIds,
      changed_question_ids: changedQuestionIds,
      is_complete: pendingQuestions.length === 0
    };
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

  async submitAnswers(
    caller: CallerScope,
    answers: Record<string, unknown>,
    skippedQuestionIds: string[] = [],
    idempotencyKey?: string
  ): Promise<FinalizeResult> {
    if (idempotencyKey) {
      const cached = this.finalizeIdempotency.get(idempotencyKey);
      if (cached) return cached;
    }

    const lookup = this.questionLookup(caller);
    const changedQuestionIds = [...Object.keys(answers), ...skippedQuestionIds];
    const overlap = skippedQuestionIds.filter((id) => Object.prototype.hasOwnProperty.call(answers, id));
    if (overlap.length > 0) throw new Error('ANSWER_VALIDATION_FAILED');

    for (const [questionId, answer] of Object.entries(answers)) {
      const entry = lookup.get(questionId);
      if (!entry || entry.question.status !== 'pending') throw new Error('QUESTION_NOT_FOUND');
      const validation = validateAnswerSet([entry.question as any], { [questionId]: answer as any });
      if (!validation.ok) throw new Error('ANSWER_VALIDATION_FAILED');
    }

    for (const questionId of skippedQuestionIds) {
      const entry = lookup.get(questionId);
      if (!entry || entry.question.status !== 'pending') throw new Error('QUESTION_NOT_FOUND');
      const validation = validateAnswerSet([entry.question as any], {}, [questionId]);
      if (!validation.ok) throw new Error('ANSWER_VALIDATION_FAILED');
    }

    const touchedGroups = new Set<ScopedQuestionGroup>();
    const now = new Date().toISOString();
    for (const [questionId, answer] of Object.entries(answers)) {
      const entry = lookup.get(questionId)!;
      entry.question.answer = answer;
      entry.question.status = 'answered';
      entry.question.updated_at = now;
      touchedGroups.add(entry.group);
    }
    for (const questionId of skippedQuestionIds) {
      const entry = lookup.get(questionId)!;
      entry.question.status = 'skipped';
      entry.question.updated_at = now;
      touchedGroups.add(entry.group);
    }

    for (const group of touchedGroups) {
      group.updated_at = now;
      this.recomputeGroupStatus(group);
      this.syncPendingScope(group);
    }

    const snapshot = await this.getScopeSnapshot(caller, changedQuestionIds);
    const result: FinalizeResult = {
      status: snapshot.is_complete ? 'answered' : 'in_progress',
      answered_question_ids: snapshot.answered_question_ids,
      skipped_question_ids: snapshot.skipped_question_ids,
      cancelled_question_ids: snapshot.cancelled_question_ids,
      changed_question_ids: snapshot.changed_question_ids,
      pending_questions: snapshot.pending_questions,
      answered_at: snapshot.is_complete ? now : undefined,
      is_complete: snapshot.is_complete
    };

    if (idempotencyKey) {
      this.finalizeIdempotency.set(idempotencyKey, result);
    }

    return result;
  }

  async cancelQuestions(
    caller: CallerScope,
    questionIds?: string[],
    cancelAll?: boolean,
    reason?: string
  ): Promise<ScopeQuestionSnapshot & { status: 'cancelled' }> {
    const lookup = this.questionLookup(caller);
    const targets = cancelAll
      ? Array.from(lookup.values())
          .filter((entry) => entry.question.status === 'pending')
          .map((entry) => String(entry.question.question_id))
      : (questionIds ?? []);
    const now = new Date().toISOString();
    const touchedGroups = new Set<ScopedQuestionGroup>();

    for (const questionId of targets) {
      const entry = lookup.get(questionId);
      if (!entry || entry.question.status !== 'pending') continue;
      entry.question.status = 'cancelled';
      entry.question.updated_at = now;
      entry.question.cancel_reason = reason;
      touchedGroups.add(entry.group);
    }

    for (const group of touchedGroups) {
      group.updated_at = now;
      this.recomputeGroupStatus(group);
      this.syncPendingScope(group);
    }

    return {
      ...(await this.getScopeSnapshot(caller, targets)),
      status: 'cancelled'
    };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('REQUEST_NOT_FOUND');
    transitionStatus(group.status, 'expired');
    group.status = 'expired';
    group.updated_at = new Date().toISOString();
    this.syncPendingScope(group);
    return { status: 'expired', reason };
  }
}
