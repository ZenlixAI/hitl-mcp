import { describe, it, expect, beforeEach } from 'vitest';
import Redis from 'ioredis-mock';
import { RedisHitlRepository } from '../../src/storage/redis-hitl-repository.js';

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
          type: 'text',
          title: 'why'
        }
      ]
    });

    const group = await repository.getGroup(created.question_group_id);
    const current = await repository.getPendingGroupByScope('api_key:a1', 'session-1');
    const generatedQuestionId = String(created.questions[0].question_id);
    const question = await repository.getQuestion(generatedQuestionId);

    expect(created.question_group_id).toMatch(/^qg_/);
    expect(group?.question_group_id).toBe(created.question_group_id);
    expect(current?.question_group_id).toBe(created.question_group_id);
    expect(question?.question_id).toBe(generatedQuestionId);
  });

  it('supports create and submit idempotency keys', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-2',
      title: 'group',
      idempotency_key: 'create-idem-1',
      questions: [
        {
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
          type: 'single_choice',
          title: 'pick',
          options: [{ value: 'A', label: 'A' }]
        }
      ]
    });

    const caller = {
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-2'
    };
    const generatedQuestionId = String(created.questions[0].question_id);

    const first = await repository.submitAnswers(
      caller,
      { [generatedQuestionId]: { value: 'A' } },
      [],
      'redis-idem-1'
    );
    const second = await repository.submitAnswers(
      caller,
      { [generatedQuestionId]: { value: 'B' } },
      [],
      'redis-idem-1'
    );

    expect(repeated.question_group_id).toBe(created.question_group_id);
    expect(second).toEqual(first);
  });

  it('stores timeout metadata and derived default answers in redis', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-3',
      title: 'group',
      timeout_seconds: 900,
      questions: [
        {
          type: 'single_choice',
          title: 'pick',
          options: [{ value: 'A', label: 'A' }],
          default_answer: { value: 'A' }
        }
      ]
    });

    const stored = await repository.getGroup(created.question_group_id);

    expect(stored?.timeout_seconds).toBe(900);
    expect(stored?.questions[0]).toEqual(
      expect.objectContaining({
        default_answer: { value: 'A' }
      })
    );
    expect(stored?.auto_response_deadline_at).toMatch(/T/);
  });

  it('auto-responds timed out pending questions with timeout metadata', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-timeout-1',
      title: 'group',
      timeout_seconds: 1,
      questions: [
        {
          type: 'boolean',
          title: 'approve?',
          default_answer: { value: true }
        }
      ]
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const [result] = await repository.processTimedOutGroups?.();
    const stored = await repository.getGroup(created.question_group_id);

    expect(result?.groupId).toBe(created.question_group_id);
    expect(stored?.questions[0]).toEqual(
      expect.objectContaining({
        status: 'answered',
        answer: { value: true },
        is_timeout_auto_response: true
      })
    );
  });

  it('allows only one processor to claim the same timed out group', async () => {
    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-timeout-2',
      title: 'group',
      timeout_seconds: 1,
      questions: [
        {
          type: 'text',
          title: 'why',
          default_answer: { value: 'fallback' }
        }
      ]
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const [first, second] = await Promise.all([
      repository.processTimedOutGroups?.(),
      repository.processTimedOutGroups?.()
    ]);

    const processedCount = [...(first ?? []), ...(second ?? [])].filter(
      (entry) => entry.groupId === created.question_group_id
    ).length;

    expect(processedCount).toBe(1);
  });
});
