import type { HitlRepository } from '../storage/hitl-repository.js';
import type { Waiter } from './waiter.js';
import type { Logger } from '../observability/logger.js';

export class MemoryTimeoutWorker {
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;

  constructor(
    private readonly repository: HitlRepository,
    private readonly waiter: Waiter,
    private readonly intervalSeconds: number,
    private readonly logger?: Logger
  ) {}

  start() {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      if (this.processing) return;
      this.processing = true;
      try {
        const results = await this.repository.processTimedOutGroups?.();
        for (const result of results ?? []) {
          this.logger?.info('memory_timeout_group_processed', {
            group_id: result.groupId,
            scope_key: result.scopeKey,
            changed_question_ids: result.snapshot.changed_question_ids,
            pending_question_count: result.snapshot.pending_questions.length,
            resolved_question_count: result.snapshot.resolved_questions.length,
            is_complete: result.snapshot.is_complete
          });
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
