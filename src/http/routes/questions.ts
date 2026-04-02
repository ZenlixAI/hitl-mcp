import { Hono } from 'hono';
import { fail, ok } from '../response';
import type { HitlRepository } from '../../storage/hitl-repository';

export function questionRoutes(deps: { repository: HitlRepository }) {
  const app = new Hono();

  app.get('/questions/:questionId', async (c) => {
    const requestId = c.get('requestId') ?? 'local';
    const questionId = c.req.param('questionId');
    const question = await deps.repository.getQuestion(questionId);

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
