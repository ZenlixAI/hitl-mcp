import { Hono } from 'hono';
import { fail, ok } from '../response';
import { validateAnswerSet } from '../../domain/validators';
import type { HitlMetrics } from '../../observability/metrics';
import type { HitlRepository } from '../../storage/hitl-repository';
import type { Waiter } from '../../state/waiter';

export function questionGroupRoutes(deps: {
  repository: HitlRepository;
  waiter: Waiter;
  metrics?: HitlMetrics;
}) {
  const app = new Hono();

  app.get('/question-groups/current', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const agentIdentity = c.get('agentIdentity');
    const agentSessionId = c.get('agentSessionId');
    const group = await deps.repository.getPendingGroupByScope(agentIdentity, agentSessionId);

    if (!group) {
      return c.json(
        fail(requestId, 'PENDING_GROUP_NOT_FOUND', 'no pending group for current caller scope'),
        404
      );
    }

    return c.json(ok(requestId, group));
  });

  app.get('/question-groups/:questionGroupId', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const group = await deps.repository.getGroup(c.req.param('questionGroupId'));

    if (!group) {
      return c.json(
        fail(requestId, 'QUESTION_GROUP_NOT_FOUND', 'question group not found'),
        404
      );
    }

    return c.json(ok(requestId, group));
  });

  app.put('/question-groups/:questionGroupId/answers/finalize', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const groupId = c.req.param('questionGroupId');
    const body = await c.req.json();
    const skippedQuestionIds = Array.isArray(body.skipped_question_ids)
      ? body.skipped_question_ids.filter((item: unknown): item is string => typeof item === 'string')
      : [];

    const group = await deps.repository.getGroup(groupId);
    if (!group) {
      return c.json(
        fail(requestId, 'QUESTION_GROUP_NOT_FOUND', 'question group not found'),
        404
      );
    }

    const validation = validateAnswerSet(
      (group.questions as any[]) ?? [],
      (body.answers ?? {}) as Record<string, { value: unknown }>,
      skippedQuestionIds
    );

    if (!validation.ok) {
      deps.metrics?.incFinalizeValidationFailed();
      return c.json(
        fail(
          requestId,
          'ANSWER_VALIDATION_FAILED',
          `${validation.errors.length} 个问题未通过校验，请修正后重试。`,
          validation.errors,
          { question_group_id: groupId, status: 'pending' }
        ),
        422
      );
    }

    const saved = await deps.repository.finalizeAnswers(
      groupId,
      body.answers ?? {},
      skippedQuestionIds,
      body.idempotency_key
    );
    deps.metrics?.incFinalizeSuccess();

    deps.waiter.notify(groupId, {
      question_group_id: groupId,
      status: 'answered',
      answers: body.answers ?? {},
      skipped_question_ids: skippedQuestionIds,
      answered_at: saved.answered_at
    });

    return c.json(
      ok(requestId, {
        question_group_id: groupId,
        status: 'answered',
        answered_question_ids: saved.answered_question_ids,
        skipped_question_ids: saved.skipped_question_ids,
        answered_at: saved.answered_at
      })
    );
  });

  app.post('/question-groups/:questionGroupId/cancel', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const groupId = c.req.param('questionGroupId');
    const body = await c.req.json().catch(() => ({}));
    const result = await deps.repository.cancelGroup(groupId, body.reason);
    deps.waiter.notify(groupId, {
      question_group_id: groupId,
      status: 'cancelled',
      reason: body.reason
    });
    return c.json(ok(requestId, result));
  });

  app.post('/question-groups/:questionGroupId/expire', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const groupId = c.req.param('questionGroupId');
    const result = await deps.repository.expireGroup(groupId, 'manual expire');
    deps.waiter.notify(groupId, {
      question_group_id: groupId,
      status: 'expired'
    });
    return c.json(ok(requestId, result));
  });

  return app;
}
