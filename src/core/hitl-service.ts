import { DomainError } from '../domain/errors';
import { createRequestInputSchema, waitQuestionGroupInputSchema } from '../domain/schemas';
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

  async createRequest(params: {
    caller: CallerScope;
    input: unknown;
  }) {
    const parsed = createRequestInputSchema.parse(params.input);
    return this.repository.createPendingGroup({
      agent_identity: params.caller.agent_identity,
      agent_session_id: params.caller.agent_session_id,
      ...parsed
    });
  }

  async getCurrentRequest(caller: CallerScope) {
    return this.repository.getPendingGroupByScope(caller.agent_identity, caller.agent_session_id);
  }

  async waitRequest(params: {
    caller: CallerScope;
    request_id?: string;
  }) {
    const parsed = waitQuestionGroupInputSchema.parse({
      request_id: params.request_id
    });
    const current =
      parsed.request_id
        ? null
        : await this.repository.getPendingGroupByScope(
            params.caller.agent_identity,
            params.caller.agent_session_id
          );
    const groupId = parsed.request_id ?? current?.question_group_id;

    if (!groupId) {
      throw new DomainError(
        'PENDING_REQUEST_NOT_FOUND',
        'no pending request for caller scope'
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

  async getRequestStatus(requestId: string) {
    return this.repository.getGroupStatus(requestId);
  }

  async getQuestion(questionId: string) {
    return this.repository.getQuestion(questionId);
  }

  async cancelRequest(requestId: string, reason?: string) {
    const result = await this.repository.cancelGroup(requestId, reason);
    this.waiter.notify(requestId, {
      request_id: requestId,
      status: 'cancelled',
      reason
    });
    return result;
  }

  notifyAnswered(requestId: string, payload: Record<string, unknown>) {
    this.waiter.notify(requestId, payload);
  }
}
