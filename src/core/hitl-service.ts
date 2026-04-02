import { DomainError } from '../domain/errors';
import { createQuestionGroupInputSchema, waitQuestionGroupInputSchema } from '../domain/schemas';
import type { CallerScope } from '../domain/types';
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

  async createQuestionGroup(params: {
    caller: CallerScope;
    input: unknown;
  }) {
    const parsed = createQuestionGroupInputSchema.parse(params.input);
    return this.repository.createPendingGroup({
      agent_identity: params.caller.agent_identity,
      agent_session_id: params.caller.agent_session_id,
      ...parsed
    });
  }

  async getCurrentQuestionGroup(caller: CallerScope) {
    return this.repository.getPendingGroupByScope(caller.agent_identity, caller.agent_session_id);
  }

  async waitQuestionGroup(params: {
    caller: CallerScope;
    question_group_id?: string;
  }) {
    const parsed = waitQuestionGroupInputSchema.parse({
      question_group_id: params.question_group_id
    });
    const current =
      parsed.question_group_id
        ? null
        : await this.repository.getPendingGroupByScope(
            params.caller.agent_identity,
            params.caller.agent_session_id
          );
    const groupId = parsed.question_group_id ?? current?.question_group_id;

    if (!groupId) {
      throw new DomainError(
        'PENDING_GROUP_NOT_FOUND',
        'no pending question group for caller scope'
      );
    }

    const timeoutMs = this.maxWaitSeconds > 0 ? this.maxWaitSeconds * 1000 : 0;
    const start = Date.now();
    this.metrics?.setPendingCount(this.waiter.size() + 1);
    try {
      const result = await this.waiter.wait(groupId, timeoutMs);
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
