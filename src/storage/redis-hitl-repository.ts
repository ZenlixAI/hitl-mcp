import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { CallerScope, ScopeQuestionSnapshot, ScopedQuestionGroup } from '../domain/types';
import { validateAnswerSet } from '../domain/validators';
import { transitionStatus } from '../state/status-machine';
import { redisKeys } from './redis-keys';
import type { CreatePendingGroupInput, FinalizeResult, HitlRepository } from './hitl-repository';

export class RedisHitlRepository implements HitlRepository {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly ttlSeconds: number
  ) {}

  async isReady(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup> {
    const idemKey = input.idempotency_key
      ? redisKeys.createIdem(this.prefix, input.agent_identity, input.agent_session_id, input.idempotency_key)
      : null;

    if (idemKey) {
      const existingId = await this.redis.get(idemKey);
      if (existingId) {
        return (await this.getGroup(existingId))!;
      }
    }

    const groupId = `qg_${randomUUID()}`;
    const now = new Date().toISOString();
    const persistedQuestions = input.questions.map((question) => ({
      ...question,
      question_id: `q_${randomUUID()}`,
      status: 'pending',
      created_at: now,
      updated_at: now
    }));
    const group: ScopedQuestionGroup = {
      agent_identity: input.agent_identity,
      agent_session_id: input.agent_session_id,
      question_group_id: groupId,
      title: input.title,
      description: input.description,
      questions: persistedQuestions,
      status: 'pending',
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
      extra: input.extra
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(group), 'EX', this.ttlSeconds);
    tx.sadd(redisKeys.pendingScope(this.prefix, input.agent_identity, input.agent_session_id), groupId);
    tx.expire(redisKeys.pendingScope(this.prefix, input.agent_identity, input.agent_session_id), this.ttlSeconds);
    tx.sadd(redisKeys.scopeGroups(this.prefix, input.agent_identity, input.agent_session_id), groupId);
    tx.expire(redisKeys.scopeGroups(this.prefix, input.agent_identity, input.agent_session_id), this.ttlSeconds);
    if (idemKey) {
      tx.set(idemKey, groupId, 'EX', this.ttlSeconds);
    }

    for (const question of persistedQuestions) {
      const questionId = String(question.question_id);
      tx.set(
        redisKeys.q(this.prefix, questionId),
        JSON.stringify(question),
        'EX',
        this.ttlSeconds
      );
      tx.set(redisKeys.idxQ2G(this.prefix, questionId), groupId, 'EX', this.ttlSeconds);
    }

    await tx.exec();
    return group;
  }

  async getGroup(groupId: string): Promise<ScopedQuestionGroup | null> {
    const raw = await this.redis.get(redisKeys.qg(this.prefix, groupId));
    return raw ? (JSON.parse(raw) as ScopedQuestionGroup) : null;
  }

  async getPendingGroupByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<ScopedQuestionGroup | null> {
    const groupIds = await this.redis.smembers(redisKeys.pendingScope(this.prefix, agentIdentity, agentSessionId));
    return groupIds[0] ? this.getGroup(groupIds[0]) : null;
  }

  async getPendingGroupsByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<ScopedQuestionGroup[]> {
    const groupIds = await this.redis.smembers(redisKeys.pendingScope(this.prefix, agentIdentity, agentSessionId));
    const groups = await Promise.all(groupIds.map((groupId) => this.getGroup(groupId)));
    return groups.filter(Boolean) as ScopedQuestionGroup[];
  }

  async getPendingQuestionsByScope(
    agentIdentity: string,
    agentSessionId: string
  ): Promise<Array<Record<string, unknown>>> {
    const groups = await this.getPendingGroupsByScope(agentIdentity, agentSessionId);
    return groups.flatMap((group) =>
      (group.questions as Array<Record<string, unknown>>).filter((question) => question.status === 'pending')
    );
  }

  async getGroupByCreateIdempotency(
    agentIdentity: string,
    agentSessionId: string,
    idempotencyKey: string
  ): Promise<ScopedQuestionGroup | null> {
    const groupId = await this.redis.get(
      redisKeys.createIdem(this.prefix, agentIdentity, agentSessionId, idempotencyKey)
    );
    return groupId ? this.getGroup(groupId) : null;
  }

  async getQuestion(questionId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(redisKeys.q(this.prefix, questionId));
    return raw ? JSON.parse(raw) : null;
  }

  async getScopeSnapshot(
    caller: CallerScope,
    changedQuestionIds: string[] = []
  ): Promise<ScopeQuestionSnapshot> {
    const groupIds = await this.redis.smembers(
      redisKeys.scopeGroups(this.prefix, caller.agent_identity, caller.agent_session_id)
    );
    const groups = (
      await Promise.all(groupIds.map((groupId) => this.getGroup(groupId)))
    ).filter(Boolean) as ScopedQuestionGroup[];

    const pendingQuestions: Array<Record<string, unknown>> = [];
    const resolvedQuestions: ScopeQuestionSnapshot['resolved_questions'] = [];
    const answeredQuestionIds: string[] = [];
    const skippedQuestionIds: string[] = [];
    const cancelledQuestionIds: string[] = [];

    for (const group of groups) {
      for (const question of group.questions as Array<Record<string, unknown>>) {
        const status = question.status as string;
        if (status === 'pending') pendingQuestions.push(question);
        if (status === 'answered') {
          answeredQuestionIds.push(String(question.question_id));
          resolvedQuestions.push({
            question,
            status: 'answered',
            ...(Object.prototype.hasOwnProperty.call(question, 'answer')
              ? { answer: question.answer }
              : {})
          });
        }
        if (status === 'skipped') {
          skippedQuestionIds.push(String(question.question_id));
          resolvedQuestions.push({
            question,
            status: 'skipped'
          });
        }
        if (status === 'cancelled') {
          cancelledQuestionIds.push(String(question.question_id));
          resolvedQuestions.push({
            question,
            status: 'cancelled'
          });
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
    const group = await this.getGroup(groupId);
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
    const idemKey = idempotencyKey ? redisKeys.idem(this.prefix, 'submit', idempotencyKey) : null;

    if (idemKey) {
      const cached = await this.redis.get(idemKey);
      if (cached) return JSON.parse(cached) as FinalizeResult;
    }

    const overlap = skippedQuestionIds.filter((id) => Object.prototype.hasOwnProperty.call(answers, id));
    if (overlap.length > 0) throw new Error('ANSWER_VALIDATION_FAILED');

    const changedQuestionIds = [...Object.keys(answers), ...skippedQuestionIds];
    const touchedGroups = new Map<string, ScopedQuestionGroup>();
    const now = new Date().toISOString();

    for (const [questionId, answer] of Object.entries(answers)) {
      const groupId = await this.redis.get(redisKeys.idxQ2G(this.prefix, questionId));
      if (!groupId) throw new Error('QUESTION_NOT_FOUND');
      const group = touchedGroups.get(groupId) ?? (await this.getGroup(groupId));
      if (!group) throw new Error('QUESTION_NOT_FOUND');
      const question = (group.questions as Array<Record<string, unknown>>).find((item) => item.question_id === questionId);
      if (!question || question.status !== 'pending') throw new Error('QUESTION_NOT_FOUND');
      const validation = validateAnswerSet([question as any], { [questionId]: answer as any });
      if (!validation.ok) throw new Error('ANSWER_VALIDATION_FAILED');
      question.answer = answer;
      question.status = 'answered';
      question.updated_at = now;
      group.updated_at = now;
      touchedGroups.set(groupId, group);
    }

    for (const questionId of skippedQuestionIds) {
      const groupId = await this.redis.get(redisKeys.idxQ2G(this.prefix, questionId));
      if (!groupId) throw new Error('QUESTION_NOT_FOUND');
      const group = touchedGroups.get(groupId) ?? (await this.getGroup(groupId));
      if (!group) throw new Error('QUESTION_NOT_FOUND');
      const question = (group.questions as Array<Record<string, unknown>>).find((item) => item.question_id === questionId);
      if (!question || question.status !== 'pending') throw new Error('QUESTION_NOT_FOUND');
      const validation = validateAnswerSet([question as any], {}, [questionId]);
      if (!validation.ok) throw new Error('ANSWER_VALIDATION_FAILED');
      question.status = 'skipped';
      question.updated_at = now;
      group.updated_at = now;
      touchedGroups.set(groupId, group);
    }

    const tx = this.redis.multi();
    for (const [groupId, group] of touchedGroups) {
      const hasPending = (group.questions as Array<Record<string, unknown>>).some((question) => question.status === 'pending');
      group.status = hasPending ? 'pending' : 'answered';
      tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(group), 'EX', this.ttlSeconds);
      for (const question of group.questions as Array<Record<string, unknown>>) {
        tx.set(redisKeys.q(this.prefix, String(question.question_id)), JSON.stringify(question), 'EX', this.ttlSeconds);
      }
      if (hasPending) tx.sadd(redisKeys.pendingScope(this.prefix, caller.agent_identity, caller.agent_session_id), groupId);
      else tx.srem(redisKeys.pendingScope(this.prefix, caller.agent_identity, caller.agent_session_id), groupId);
      tx.expire(redisKeys.pendingScope(this.prefix, caller.agent_identity, caller.agent_session_id), this.ttlSeconds);
    }
    await tx.exec();

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
    if (idemKey) {
      await this.redis.set(idemKey, JSON.stringify(result), 'EX', this.ttlSeconds);
    }
    return result;
  }

  async cancelQuestions(
    caller: CallerScope,
    questionIds?: string[],
    cancelAll?: boolean,
    reason?: string
  ): Promise<ScopeQuestionSnapshot & { status: 'cancelled' }> {
    const targetIds =
      cancelAll
        ? (await this.getPendingQuestionsByScope(caller.agent_identity, caller.agent_session_id)).map((question) =>
            String(question.question_id)
          )
        : (questionIds ?? []);
    const now = new Date().toISOString();
    const touchedGroups = new Map<string, ScopedQuestionGroup>();

    for (const questionId of targetIds) {
      const groupId = await this.redis.get(redisKeys.idxQ2G(this.prefix, questionId));
      if (!groupId) continue;
      const group = touchedGroups.get(groupId) ?? (await this.getGroup(groupId));
      if (!group) continue;
      const question = (group.questions as Array<Record<string, unknown>>).find((item) => item.question_id === questionId);
      if (!question || question.status !== 'pending') continue;
      question.status = 'cancelled';
      question.updated_at = now;
      question.cancel_reason = reason;
      group.updated_at = now;
      touchedGroups.set(groupId, group);
    }

    const tx = this.redis.multi();
    for (const [groupId, group] of touchedGroups) {
      const hasPending = (group.questions as Array<Record<string, unknown>>).some((question) => question.status === 'pending');
      group.status = hasPending ? 'pending' : 'cancelled';
      tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(group), 'EX', this.ttlSeconds);
      for (const question of group.questions as Array<Record<string, unknown>>) {
        tx.set(redisKeys.q(this.prefix, String(question.question_id)), JSON.stringify(question), 'EX', this.ttlSeconds);
      }
      if (hasPending) tx.sadd(redisKeys.pendingScope(this.prefix, caller.agent_identity, caller.agent_session_id), groupId);
      else tx.srem(redisKeys.pendingScope(this.prefix, caller.agent_identity, caller.agent_session_id), groupId);
    }
    await tx.exec();

    return {
      ...(await this.getScopeSnapshot(caller, targetIds)),
      status: 'cancelled'
    };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('REQUEST_NOT_FOUND');
    transitionStatus(group.status, 'expired');

    const nextGroup: ScopedQuestionGroup = {
      ...group,
      status: 'expired',
      updated_at: new Date().toISOString()
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    tx.srem(redisKeys.pendingScope(this.prefix, group.agent_identity, group.agent_session_id), groupId);
    await tx.exec();
    return { status: 'expired', reason };
  }
}
