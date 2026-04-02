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

  it('stores pending group and fetches question', async () => {
    await repository.createPendingGroup({
      question_group_id: 'qg_redis_1',
      title: 'group',
      questions: [
        {
          question_id: 'q_redis_1',
          type: 'text',
          title: 'why'
        }
      ]
    });

    const group = await repository.getGroup('qg_redis_1');
    const question = await repository.getQuestion('q_redis_1');

    expect(group?.question_group_id).toBe('qg_redis_1');
    expect(question?.question_id).toBe('q_redis_1');
  });

  it('supports finalize idempotency key', async () => {
    await repository.createPendingGroup({
      question_group_id: 'qg_redis_2',
      title: 'group',
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
      'qg_redis_2',
      { q_redis_2: { value: 'A' } },
      'redis-idem-1'
    );
    const second = await repository.finalizeAnswers(
      'qg_redis_2',
      { q_redis_2: { value: 'B' } },
      'redis-idem-1'
    );

    expect(second).toEqual(first);
  });
});
