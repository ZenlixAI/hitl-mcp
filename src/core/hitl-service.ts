import { askQuestionsInputSchema, cancelQuestionsInputSchema, submitAnswersInputSchema, waitQuestionsInputSchema } from '../domain/schemas';
import type { CallerScope, ScopeQuestionSnapshot } from '../domain/types';
import type { HitlMetrics } from '../observability/metrics';
import type { HitlRepository } from '../storage/hitl-repository';
import type { Waiter } from '../state/waiter';

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
    this.metrics?.setPendingCount(this.waiter.size() + 1);
    try {
      while (true) {
        const snapshot = await this.repository.getScopeSnapshot(params.caller);
        if (snapshot.is_complete) {
          return {
            status: 'completed',
            is_terminal: true,
            ...snapshot
          };
        }

        const result = (await this.waiter.wait(this.scopeKey(params.caller), timeoutMs)) as ScopeQuestionSnapshot;
        if (this.waitMode === 'progressive') {
          return {
            status: result.is_complete ? 'completed' : 'in_progress',
            is_terminal: result.is_complete,
            ...result
          };
        }

        if (result.is_complete) {
          return {
            status: 'completed',
            is_terminal: true,
            ...result
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
