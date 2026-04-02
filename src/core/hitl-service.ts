import { askQuestionGroupInputSchema } from '../domain/schemas';
import type { HitlMetrics } from '../observability/metrics';
import type { HitlRepository } from '../storage/hitl-repository';
import type { Waiter } from '../state/waiter';

export class HitlService {
  constructor(
    private readonly repository: HitlRepository,
    private readonly waiter: Waiter,
    private readonly maxWaitSeconds: number,
    private readonly metrics?: HitlMetrics
  ) {}

  async askQuestionGroup(input: unknown) {
    const parsed = askQuestionGroupInputSchema.parse(input);
    await this.repository.createPendingGroup(parsed);

    const timeoutMs = this.maxWaitSeconds > 0 ? this.maxWaitSeconds * 1000 : 0;
    const start = Date.now();
    this.metrics?.setPendingCount(this.waiter.size() + 1);
    try {
      const result = await this.waiter.wait(parsed.question_group_id, timeoutMs);
      return result as Record<string, unknown>;
    } finally {
      this.metrics?.observeWaitDuration(Date.now() - start);
      this.metrics?.setPendingCount(this.waiter.size());
    }
  }

  async getQuestionGroupStatus(questionGroupId: string) {
    return this.repository.getGroupStatus(questionGroupId);
  }

  async getQuestion(questionId: string) {
    return this.repository.getQuestion(questionId);
  }

  async cancelQuestionGroup(questionGroupId: string, reason?: string) {
    const result = await this.repository.cancelGroup(questionGroupId, reason);
    this.waiter.notify(questionGroupId, {
      question_group_id: questionGroupId,
      status: 'cancelled',
      reason
    });
    return result;
  }

  notifyAnswered(questionGroupId: string, payload: Record<string, unknown>) {
    this.waiter.notify(questionGroupId, payload);
  }
}
