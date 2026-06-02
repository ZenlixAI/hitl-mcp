import type { RedisClient } from '../storage/redis-client.js';
import type { RedisHitlRepository } from '../storage/redis-hitl-repository.js';

export class RedisTimeoutWorker {
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    private readonly repository: RedisHitlRepository,
    private readonly publisher: RedisClient,
    private readonly eventChannel: string,
    private readonly intervalSeconds: number
  ) {}

  start() {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      if (this.processing) return;
      this.processing = true;
      try {
        const results = await this.repository.processTimedOutGroups?.();
        for (const result of results ?? []) {
          await this.publisher.publish(this.eventChannel, JSON.stringify(result));
        }
      } finally {
        this.processing = false;
      }
    }, this.intervalSeconds * 1000);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
