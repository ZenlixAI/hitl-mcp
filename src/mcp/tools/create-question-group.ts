import { object, error, type MCPServer } from 'mcp-use/server';
import { askToolInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

export function registerAskTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_ask',
      description: 'Create one or more pending questions for the current caller scope.',
      schema: askToolInputSchema
    },
    async (input, ctx) => {
      try {
        const { wait_after_ask = true, ...askInput } = input;
        const caller = readCallerScopeFromMcpContext(ctx);
        const questions = await service.askQuestions({
          caller,
          input: askInput
        });
        if (!wait_after_ask) {
          return object({ questions });
        }

        try {
          const wait = await service.waitForQuestionIds({
            caller,
            questionIds: questions.map((question) => String(question.question_id))
          });
          return object({ questions, wait });
        } catch (waitErr) {
          logger.warn('mcp_ask_wait_failed', {
            tool_name: 'hitl_ask',
            error: waitErr
          });

          if (waitErr instanceof Error && waitErr.message === 'wait timeout') {
            const pendingQuestions = (await service.getPendingQuestions(caller)).filter((question) =>
              questions.some((created) => String(created.question_id) === String(question.question_id))
            );
            return object({
              questions,
              wait: {
                status: 'timeout',
                is_terminal: false,
                pending_questions: pendingQuestions,
                resolved_questions: [],
                answered_question_ids: [],
                skipped_question_ids: [],
                cancelled_question_ids: [],
                changed_question_ids: [],
                is_complete: false
              }
            });
          }

          throw waitErr;
        }
      } catch (err) {
        logger.warn('mcp_ask_failed', {
          tool_name: 'hitl_ask',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to ask questions');
      }
    }
  );
}
