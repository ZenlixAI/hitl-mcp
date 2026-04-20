import { askQuestionsInputSchema, cancelQuestionsInputSchema, submitAnswersInputSchema, waitQuestionsInputSchema } from '../domain/schemas.js';
import type { CallerScope, ScopeQuestionSnapshot } from '../domain/types.js';
import type { HitlMetrics } from '../observability/metrics.js';
import type { HitlRepository } from '../storage/hitl-repository.js';
import type { Waiter } from '../state/waiter.js';

export class HitlService {
  constructor(
    private readonly repository: HitlRepository,
    private readonly waiter: Waiter,
    private readonly maxWaitSeconds: number,
    private readonly waitMode: 'terminal_only' | 'progressive',
    private readonly metrics?: HitlMetrics
  ) {}

  private scopeKey(caller: CallerScope) {
    return `${caller.agent_identity}::${caller.agent_session_id}`;
  }

  private filterWaitSnapshot(
    snapshot: ScopeQuestionSnapshot,
    pendingQuestionIdsAtWaitStart: Set<string>
  ): ScopeQuestionSnapshot {
    const includes = (questionId: unknown) => pendingQuestionIdsAtWaitStart.has(String(questionId));
    const pendingQuestions = snapshot.pending_questions.filter((question) =>
      includes(question.question_id)
    );
    const resolvedQuestions = snapshot.resolved_questions.filter((entry) =>
      includes(entry.question.question_id)
    );
    const answeredQuestionIds = snapshot.answered_question_ids.filter((questionId) =>
      includes(questionId)
    );
    const skippedQuestionIds = snapshot.skipped_question_ids.filter((questionId) =>
      includes(questionId)
    );
    const cancelledQuestionIds = snapshot.cancelled_question_ids.filter((questionId) =>
      includes(questionId)
    );
    const changedQuestionIds = snapshot.changed_question_ids.filter((questionId) =>
      includes(questionId)
    );

    return {
      pending_questions: pendingQuestions,
      resolved_questions: resolvedQuestions,
      answered_question_ids: answeredQuestionIds,
      skipped_question_ids: skippedQuestionIds,
      cancelled_question_ids: cancelledQuestionIds,
      changed_question_ids: changedQuestionIds,
      is_complete: pendingQuestions.length === 0
    };
  }

  async askQuestions(params: {
    caller: CallerScope;
    input: unknown;
  }) {
    const parsed = askQuestionsInputSchema.parse(params.input);
    const created = await this.repository.createPendingGroup({
      agent_identity: params.caller.agent_identity,
      agent_session_id: params.caller.agent_session_id,
      ...parsed
    });
    return created.questions;
  }

  async getPendingQuestions(caller: CallerScope) {
    return this.repository.getPendingQuestionsByScope(caller.agent_identity, caller.agent_session_id);
  }

  async wait(params: {
    caller: CallerScope;
  }) {
    waitQuestionsInputSchema.parse({});
    const timeoutMs = this.maxWaitSeconds > 0 ? this.maxWaitSeconds * 1000 : 0;
    const start = Date.now();
    const snapshotAtWaitStart = await this.repository.getScopeSnapshot(params.caller);
    const pendingQuestionIdsAtWaitStart = new Set(
      snapshotAtWaitStart.pending_questions.map((question) => String(question.question_id))
    );
    const initialSnapshot = this.filterWaitSnapshot(
      snapshotAtWaitStart,
      pendingQuestionIdsAtWaitStart
    );
    this.metrics?.setPendingCount(this.waiter.size() + 1);
    try {
      if (initialSnapshot.is_complete) {
        return {
          status: 'completed',
          is_terminal: true,
          ...initialSnapshot
        };
      }

      while (true) {
        const result = (await this.waiter.wait(this.scopeKey(params.caller), timeoutMs)) as ScopeQuestionSnapshot;
        const filteredResult = this.filterWaitSnapshot(result, pendingQuestionIdsAtWaitStart);
        if (!filteredResult.is_complete && filteredResult.changed_question_ids.length === 0) {
          continue;
        }

        if (this.waitMode === 'progressive') {
          return {
            status: filteredResult.is_complete ? 'completed' : 'in_progress',
            is_terminal: filteredResult.is_complete,
            ...filteredResult
          };
        }

        if (filteredResult.is_complete) {
          return {
            status: 'completed',
            is_terminal: true,
            ...filteredResult
          };
        }
      }
    } finally {
      this.metrics?.observeWaitDuration(Date.now() - start);
      this.metrics?.setPendingCount(this.waiter.size());
    }
  }

  async submitAnswers(params: {
    caller: CallerScope;
    input: unknown;
  }) {
    const parsed = submitAnswersInputSchema.parse(params.input);
    const result = await this.repository.submitAnswers(
      params.caller,
      parsed.answers ?? {},
      parsed.skipped_question_ids ?? [],
      parsed.idempotency_key
    );
    const snapshot = await this.repository.getScopeSnapshot(params.caller, result.changed_question_ids ?? []);
    this.waiter.notify(this.scopeKey(params.caller), snapshot);
    return {
      status: snapshot.is_complete ? 'completed' : 'in_progress',
      is_terminal: snapshot.is_complete,
      ...snapshot
    };
  }

  async cancelQuestions(params: {
    caller: CallerScope;
    input: unknown;
  }) {
    const parsed = cancelQuestionsInputSchema.parse(params.input);
    const snapshot = await this.repository.cancelQuestions(
      params.caller,
      parsed.question_ids,
      parsed.cancel_all,
      parsed.reason
    );
    this.waiter.notify(this.scopeKey(params.caller), snapshot);
    return snapshot;
  }

  async getQuestion(questionId: string) {
    return this.repository.getQuestion(questionId);
  }
}
