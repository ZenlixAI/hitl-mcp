import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { ScopedQuestionGroup } from '../domain/types';
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
    const group: ScopedQuestionGroup = {
      agent_identity: input.agent_identity,
      agent_session_id: input.agent_session_id,
      question_group_id: groupId,
      title: input.title,
      description: input.description,
      questions: input.questions,
      status: 'pending',
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
      extra: input.extra
    };

    const pendingKey = redisKeys.pendingScope(this.prefix, input.agent_identity, input.agent_session_id);
    const lockResult = await (this.redis as any).set(pendingKey, groupId, 'NX', 'EX', this.ttlSeconds);
    if (lockResult !== 'OK') {
      throw new Error('PENDING_GROUP_ALREADY_EXISTS');
    }

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(group), 'EX', this.ttlSeconds);
    if (idemKey) {
      tx.set(idemKey, groupId, 'EX', this.ttlSeconds);
    }

    for (const question of input.questions) {
      const questionId = String(question.question_id);
      tx.set(redisKeys.q(this.prefix, questionId), JSON.stringify(question), 'EX', this.ttlSeconds);
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
    const groupId = await this.redis.get(redisKeys.pendingScope(this.prefix, agentIdentity, agentSessionId));
    return groupId ? this.getGroup(groupId) : null;
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

  async getGroupStatus(groupId: string): Promise<Record<string, unknown> | null> {
    const group = await this.getGroup(groupId);
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
    const idemKey = idempotencyKey ? redisKeys.idem(this.prefix, 'finalize', idempotencyKey) : null;

    if (idemKey) {
      const cached = await this.redis.get(idemKey);
      if (cached) return JSON.parse(cached) as FinalizeResult;
    }

    const group = await this.getGroup(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'answered');

    const answeredAt = new Date().toISOString();
    const nextGroup: ScopedQuestionGroup = {
      ...group,
      status: 'answered',
      answers,
      skipped_question_ids: skippedQuestionIds,
      updated_at: answeredAt
    };

    const result: FinalizeResult = {
      status: 'answered',
      answered_question_ids: Object.keys(answers),
      skipped_question_ids: skippedQuestionIds,
      answered_at: answeredAt
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    tx.set(
      redisKeys.ans(this.prefix, groupId),
      JSON.stringify({ answers, skipped_question_ids: skippedQuestionIds, finalized_at: answeredAt }),
      'EX',
      this.ttlSeconds
    );
    tx.del(redisKeys.pendingScope(this.prefix, group.agent_identity, group.agent_session_id));
    if (idemKey) {
      tx.set(idemKey, JSON.stringify(result), 'EX', this.ttlSeconds);
    }
    await tx.exec();

    return result;
  }

  async cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'cancelled');

    const nextGroup: ScopedQuestionGroup = {
      ...group,
      status: 'cancelled',
      updated_at: new Date().toISOString()
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    tx.del(redisKeys.pendingScope(this.prefix, group.agent_identity, group.agent_session_id));
    await tx.exec();
    return { status: 'cancelled', reason };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'expired');

    const nextGroup: ScopedQuestionGroup = {
      ...group,
      status: 'expired',
      updated_at: new Date().toISOString()
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    tx.del(redisKeys.pendingScope(this.prefix, group.agent_identity, group.agent_session_id));
    await tx.exec();
    return { status: 'expired', reason };
  }
}
