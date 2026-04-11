import { Hono } from 'hono';
import { fail, ok } from '../response.js';
import type { HitlMetrics } from '../../observability/metrics.js';
import type { Logger } from '../../observability/logger.js';
import type { HitlService } from '../../core/hitl-service.js';

function errorCode(error: unknown) {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}

function logLevelForError(code: string) {
  return code === 'ANSWER_VALIDATION_FAILED' || code === 'QUESTION_NOT_FOUND' ? 'warn' : 'error';
}

export function questionRoutes(deps: { service: HitlService; metrics?: HitlMetrics; logger?: Logger }) {
  const app = new Hono();

  app.post('/questions', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    try {
      const result = await deps.service.askQuestions({
        caller: {
          agent_identity: c.get('agentIdentity'),
          agent_session_id: c.get('agentSessionId')
        },
        input: await c.req.json()
      });
      return c.json(ok(requestId, { questions: result }));
    } catch (error) {
      const code = errorCode(error);
      deps.logger?.[logLevelForError(code)]('ask_questions_failed', {
        request_id: requestId,
        path: c.req.path,
        code,
        error
      });
      return c.json(fail(requestId, code, 'failed to ask questions'), 422);
    }
  });

  app.get('/questions/pending', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    try {
      const pendingQuestions = await deps.service.getPendingQuestions({
        agent_identity: c.get('agentIdentity'),
        agent_session_id: c.get('agentSessionId')
      });
      return c.json(ok(requestId, { pending_questions: pendingQuestions }));
    } catch (error) {
      const code = errorCode(error);
      deps.logger?.[logLevelForError(code)]('get_pending_questions_failed', {
        request_id: requestId,
        path: c.req.path,
        code,
        error
      });
      return c.json(fail(requestId, code, 'failed to get pending questions'), 422);
    }
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
      const code = errorCode(error);
      deps.logger?.[logLevelForError(code)]('submit_answers_failed', {
        request_id: requestId,
        path: c.req.path,
        code,
        error
      });
      return c.json(
        fail(
          requestId,
          code,
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
      const code = errorCode(error);
      deps.logger?.[logLevelForError(code)]('cancel_questions_failed', {
        request_id: requestId,
        path: c.req.path,
        code,
        error
      });
      return c.json(
        fail(requestId, code, 'failed to cancel questions'),
        422
      );
    }
  });

  app.get('/questions/:questionId', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const questionId = c.req.param('questionId');
    let question;
    try {
      question = await deps.service.getQuestion(questionId);
    } catch (error) {
      const code = errorCode(error);
      deps.logger?.[logLevelForError(code)]('get_question_failed', {
        request_id: requestId,
        path: c.req.path,
        question_id: questionId,
        code,
        error
      });
      return c.json(fail(requestId, code, 'failed to get question'), 422);
    }

    if (!question) {
      deps.logger?.warn('question_not_found', {
        request_id: requestId,
        path: c.req.path,
        question_id: questionId
      });
      return c.json(
        fail(requestId, 'QUESTION_NOT_FOUND', 'question not found'),
        404
      );
    }

    return c.json(ok(requestId, question));
  });

  return app;
}
