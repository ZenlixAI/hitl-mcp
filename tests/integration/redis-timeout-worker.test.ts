import { afterEach, describe, expect, it } from 'vitest';
import { HitlService } from '../../src/core/hitl-service.js';
import { RedisHitlRepository } from '../../src/storage/redis-hitl-repository.js';
import { Waiter } from '../../src/state/waiter.js';
import { RedisTimeoutWorker } from '../../src/state/redis-timeout-worker.js';
import { redisKeys } from '../../src/storage/redis-keys.js';
import { createRedisTestContext, type RedisTestContext } from '../helpers/redis-test-client.js';

describe('redis timeout worker', () => {
  const workers: RedisTimeoutWorker[] = [];
  let testContext: RedisTestContext | null = null;

  afterEach(async () => {
    for (const worker of workers) worker.stop();
    workers.length = 0;
    if (testContext) {
      await testContext.cleanup();
      testContext = null;
    }
  });

  it('wakes a terminal waiter after timeout automation via pubsub notification', async () => {
    testContext = createRedisTestContext('hitl-test-integration');
    const store = testContext.createClient();
    const publisher = testContext.createClient();
    const subscriber = testContext.createClient();

    const prefix = testContext.prefix;
    const repository = new RedisHitlRepository(store as any, prefix, 3600);
    const waiter = new Waiter();
    const service = new HitlService(repository, waiter, 0, 'terminal_only');
    const eventChannel = redisKeys.timeoutEvents(prefix);

    await subscriber.subscribe(eventChannel);
    subscriber.on('message', (_channel, raw) => {
      const event = JSON.parse(raw) as { scopeKey: string; snapshot: unknown };
      waiter.notify(event.scopeKey, event.snapshot);
    });

    const worker = new RedisTimeoutWorker(repository, publisher as any, eventChannel, 1);
    workers.push(worker);
    worker.start();

    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-redis-timeout'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Timed wait',
        timeout_seconds: 1,
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const result = await service.wait({ caller });

    expect(result.status).toBe('completed');
    expect(result.is_terminal).toBe(true);
    expect(result.resolved_questions).toHaveLength(1);
    expect(result.resolved_questions[0]).toEqual(
      expect.objectContaining({
        status: 'answered',
        answer: { value: true }
      })
    );
    expect(result.resolved_questions[0].question).toEqual(
      expect.objectContaining({
        is_timeout_auto_response: true
      })
    );
  });

});
