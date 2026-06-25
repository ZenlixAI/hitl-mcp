import type { HitlRepository } from '../storage/hitl-repository.js';
import type { Waiter } from './waiter.js';

export class MemoryTimeoutWorker {
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    private readonly repository: HitlRepository,
    private readonly waiter: Waiter,
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
          this.waiter.notify(result.scopeKey, result.snapshot);
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
