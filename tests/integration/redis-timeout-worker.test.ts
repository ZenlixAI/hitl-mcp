import { afterEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis-mock';
import { HitlService } from '../../src/core/hitl-service.js';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository.js';
import { RedisHitlRepository } from '../../src/storage/redis-hitl-repository.js';
import { Waiter } from '../../src/state/waiter.js';
import { RedisTimeoutWorker } from '../../src/state/redis-timeout-worker.js';
import { redisKeys } from '../../src/storage/redis-keys.js';

describe('redis timeout worker', () => {
  const workers: RedisTimeoutWorker[] = [];
  const clients: Redis[] = [];

  afterEach(async () => {
    for (const worker of workers) worker.stop();
    workers.length = 0;
    await Promise.all(clients.map((client) => client.quit()));
    clients.length = 0;
  });

  it('wakes a terminal waiter after timeout automation via pubsub notification', async () => {
    const store = new Redis();
    const publisher = new Redis();
    const subscriber = new Redis();
    clients.push(store, publisher, subscriber);

    const prefix = 'hitl-test';
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

  it('does not auto-respond in memory mode', async () => {
    const waiter = new Waiter();
    const service = new HitlService(new InMemoryHitlRepository(), waiter, 0, 'terminal_only');
    const caller = {
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-memory-timeout'
    };

    await service.askQuestions({
      caller,
      input: {
        title: 'Memory wait',
        timeout_seconds: 1,
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });

    const outcome = await Promise.race([
      service.wait({ caller }).then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 1500))
    ]);

    expect(outcome).toBe('pending');
  });
});
