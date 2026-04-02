import { describe, it, expect, beforeEach } from 'vitest';
import Redis from 'ioredis-mock';
import { RedisHitlRepository } from '../../src/storage/redis-hitl-repository';

describe('redis repository', () => {
  let redis: Redis;
  let repository: RedisHitlRepository;

  beforeEach(() => {
    redis = new Redis();
    repository = new RedisHitlRepository(redis as any, 'hitl-test', 3600);
  });

  it('stores generated pending group and fetches it by scope and question id', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'group',
      questions: [
        {
          question_id: 'q_redis_1',
          type: 'text',
          title: 'why'
        }
      ]
    });

    const group = await repository.getGroup(created.question_group_id);
    const current = await repository.getPendingGroupByScope('api_key:a1', 'session-1');
    const question = await repository.getQuestion('q_redis_1');

    expect(created.question_group_id).toMatch(/^qg_/);
    expect(group?.question_group_id).toBe(created.question_group_id);
    expect(current?.question_group_id).toBe(created.question_group_id);
    expect(question?.question_id).toBe('q_redis_1');
  });

  it('supports create and finalize idempotency keys', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-2',
      title: 'group',
      idempotency_key: 'create-idem-1',
      questions: [
        {
          question_id: 'q_redis_2',
          type: 'single_choice',
          title: 'pick',
          options: [{ value: 'A', label: 'A' }]
        }
      ]
    });
    const repeated = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-2',
      title: 'group',
      idempotency_key: 'create-idem-1',
      questions: [
        {
          question_id: 'q_redis_2',
          type: 'single_choice',
          title: 'pick',
          options: [{ value: 'A', label: 'A' }]
        }
      ]
    });

    const first = await repository.finalizeAnswers(
      created.question_group_id,
      { q_redis_2: { value: 'A' } },
      'redis-idem-1'
    );
    const second = await repository.finalizeAnswers(
      created.question_group_id,
      { q_redis_2: { value: 'B' } },
      'redis-idem-1'
    );

    expect(repeated.question_group_id).toBe(created.question_group_id);
    expect(second).toEqual(first);
  });
});
