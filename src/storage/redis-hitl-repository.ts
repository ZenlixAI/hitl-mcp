import type Redis from 'ioredis';
import { transitionStatus } from '../state/status-machine';
import { redisKeys } from './redis-keys';
import type { FinalizeResult, HitlRepository } from './hitl-repository';

type GroupRecord = {
  question_group_id: string;
  title: string;
  questions: Array<any>;
  status: 'pending' | 'answered' | 'cancelled' | 'expired';
  answers?: Record<string, unknown>;
  updated_at: string;
};

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

  async createPendingGroup(input: any): Promise<void> {
    const now = new Date().toISOString();
    const group: GroupRecord = {
      question_group_id: input.question_group_id,
      title: input.title,
      questions: input.questions,
      status: 'pending',
      updated_at: now
    };

    const groupKey = redisKeys.qg(this.prefix, input.question_group_id);
    const tx = this.redis.multi();
    tx.set(groupKey, JSON.stringify(group), 'EX', this.ttlSeconds);

    for (const question of input.questions) {
      const qKey = redisKeys.q(this.prefix, question.question_id);
      const idxKey = redisKeys.idxQ2G(this.prefix, question.question_id);
      tx.set(qKey, JSON.stringify(question), 'EX', this.ttlSeconds);
      tx.set(idxKey, input.question_group_id, 'EX', this.ttlSeconds);
    }

    await tx.exec();
  }

  async getGroup(groupId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(redisKeys.qg(this.prefix, groupId));
    return raw ? JSON.parse(raw) : null;
  }

  async getQuestion(questionId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.redis.get(redisKeys.q(this.prefix, questionId));
    return raw ? JSON.parse(raw) : null;
  }

  async getGroupStatus(groupId: string): Promise<Record<string, unknown> | null> {
    const group = (await this.getGroup(groupId)) as GroupRecord | null;
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
    idempotencyKey?: string
  ): Promise<FinalizeResult> {
    const idemKey = idempotencyKey
      ? redisKeys.idem(this.prefix, 'finalize', idempotencyKey)
      : null;

    if (idemKey) {
      const cached = await this.redis.get(idemKey);
      if (cached) return JSON.parse(cached);
    }

    const group = (await this.getGroup(groupId)) as GroupRecord | null;
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'answered');

    const answeredAt = new Date().toISOString();
    const nextGroup: GroupRecord = {
      ...group,
      status: 'answered',
      answers,
      updated_at: answeredAt
    };

    const result: FinalizeResult = {
      status: 'answered',
      answered_question_ids: Object.keys(answers),
      answered_at: answeredAt
    };

    const tx = this.redis.multi();
    tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    tx.set(redisKeys.ans(this.prefix, groupId), JSON.stringify({ answers, finalized_at: answeredAt }), 'EX', this.ttlSeconds);
    if (idemKey) tx.set(idemKey, JSON.stringify(result), 'EX', this.ttlSeconds);
    await tx.exec();

    return result;
  }

  async cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }> {
    const group = (await this.getGroup(groupId)) as GroupRecord | null;
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'cancelled');

    const nextGroup: GroupRecord = {
      ...group,
      status: 'cancelled',
      updated_at: new Date().toISOString()
    };

    await this.redis.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    return { status: 'cancelled', reason };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = (await this.getGroup(groupId)) as GroupRecord | null;
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'expired');

    const nextGroup: GroupRecord = {
      ...group,
      status: 'expired',
      updated_at: new Date().toISOString()
    };

    await this.redis.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
    return { status: 'expired', reason };
  }
}
