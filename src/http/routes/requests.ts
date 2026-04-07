import { Hono } from 'hono';
import { fail, ok } from '../response';
import { validateAnswerSet } from '../../domain/validators';
import type { HitlMetrics } from '../../observability/metrics';
import type { HitlRepository } from '../../storage/hitl-repository';
import type { Waiter } from '../../state/waiter';

function toPublicRequestShape(input: Record<string, unknown>) {
  const { question_group_id, ...rest } = input;
  return {
    ...rest,
    request_id: question_group_id
  };
}

export function requestRoutes(deps: {
  repository: HitlRepository;
  waiter: Waiter;
  metrics?: HitlMetrics;
}) {
  const app = new Hono();

  app.get('/requests/current', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const agentIdentity = c.get('agentIdentity');
    const agentSessionId = c.get('agentSessionId');
    const group = await deps.repository.getPendingGroupByScope(agentIdentity, agentSessionId);

    if (!group) {
      return c.json(
        fail(requestId, 'PENDING_REQUEST_NOT_FOUND', 'no pending request for current caller scope'),
        404
      );
    }

    return c.json(ok(requestId, toPublicRequestShape(group as unknown as Record<string, unknown>)));
  });

  app.get('/requests/:requestId', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const group = await deps.repository.getGroup(c.req.param('requestId'));

    if (!group) {
      return c.json(
        fail(requestId, 'REQUEST_NOT_FOUND', 'request not found'),
        404
      );
    }

    return c.json(ok(requestId, toPublicRequestShape(group as unknown as Record<string, unknown>)));
  });

  app.put('/requests/:requestId/answers/finalize', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const internalId = c.req.param('requestId');
    const body = await c.req.json();
    const skippedQuestionIds = Array.isArray(body.skipped_question_ids)
      ? body.skipped_question_ids.filter((item: unknown): item is string => typeof item === 'string')
      : [];

    const group = await deps.repository.getGroup(internalId);
    if (!group) {
      return c.json(
        fail(requestId, 'REQUEST_NOT_FOUND', 'request not found'),
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
          { request_id: internalId, status: 'pending' }
        ),
        422
      );
    }

    const saved = await deps.repository.finalizeAnswers(
      internalId,
      body.answers ?? {},
      skippedQuestionIds,
      body.idempotency_key
    );
    deps.metrics?.incFinalizeSuccess();

    deps.waiter.notify(internalId, {
      request_id: internalId,
      status: 'answered',
      answers: body.answers ?? {},
      skipped_question_ids: skippedQuestionIds,
      answered_at: saved.answered_at
    });

    return c.json(
      ok(requestId, {
        request_id: internalId,
        status: 'answered',
        answered_question_ids: saved.answered_question_ids,
        skipped_question_ids: saved.skipped_question_ids,
        answered_at: saved.answered_at
      })
    );
  });

  app.post('/requests/:requestId/cancel', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const internalId = c.req.param('requestId');
    const body = await c.req.json().catch(() => ({}));
    const result = await deps.repository.cancelGroup(internalId, body.reason);
    deps.waiter.notify(internalId, {
      request_id: internalId,
      status: 'cancelled',
      reason: body.reason
    });
    return c.json(ok(requestId, result));
  });

  app.post('/requests/:requestId/expire', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const internalId = c.req.param('requestId');
    const result = await deps.repository.expireGroup(internalId, 'manual expire');
    deps.waiter.notify(internalId, {
      request_id: internalId,
      status: 'expired'
    });
    return c.json(ok(requestId, result));
  });

  return app;
}
