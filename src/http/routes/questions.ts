import { Hono } from 'hono';
import { fail, ok } from '../response';
import type { HitlMetrics } from '../../observability/metrics';
import type { HitlService } from '../../core/hitl-service';

function errorCode(error: unknown) {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}

export function questionRoutes(deps: { service: HitlService; metrics?: HitlMetrics }) {
  const app = new Hono();

  app.post('/questions', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const result = await deps.service.askQuestions({
      caller: {
        agent_identity: c.get('agentIdentity'),
        agent_session_id: c.get('agentSessionId')
      },
      input: await c.req.json()
    });
    return c.json(ok(requestId, { questions: result }));
  });

  app.get('/questions/pending', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const pendingQuestions = await deps.service.getPendingQuestions({
      agent_identity: c.get('agentIdentity'),
      agent_session_id: c.get('agentSessionId')
    });
    return c.json(ok(requestId, { pending_questions: pendingQuestions }));
  });

  app.post('/questions/answers', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    try {
      const result = await deps.service.submitAnswers({
        caller: {
          agent_identity: c.get('agentIdentity'),
          agent_session_id: c.get('agentSessionId')
        },
        input: await c.req.json()
      });
      return c.json(ok(requestId, result));
    } catch (error) {
      deps.metrics?.incFinalizeValidationFailed();
      return c.json(
        fail(
          requestId,
          errorCode(error),
          'failed to submit answers'
        ),
        422
      );
    }
  });

  app.post('/questions/cancel', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    try {
      const result = await deps.service.cancelQuestions({
        caller: {
          agent_identity: c.get('agentIdentity'),
          agent_session_id: c.get('agentSessionId')
        },
        input: await c.req.json().catch(() => ({}))
      });
      return c.json(ok(requestId, result));
    } catch (error) {
      return c.json(
        fail(requestId, errorCode(error), 'failed to cancel questions'),
        422
      );
    }
  });

  app.get('/questions/:questionId', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const questionId = c.req.param('questionId');
    const question = await deps.service.getQuestion(questionId);

    if (!question) {
      return c.json(
        fail(requestId, 'QUESTION_NOT_FOUND', 'question not found'),
        404
      );
    }

    return c.json(ok(requestId, question));
  });

  return app;
}
