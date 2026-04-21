import { object, error, type MCPServer } from 'mcp-use/server';
import { askUserToolInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

async function waitUntilTerminal(
  waitFn: () => Promise<any>
): Promise<any> {
  while (true) {
    try {
      const result = await waitFn();
      if (result?.is_terminal) {
        return result;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'wait timeout') {
        continue;
      }

      throw error;
    }
  }
}

export function registerAskUserTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_ask_user',
      description: 'Ask the human user a structured question when the task cannot safely continue without a human choice, confirmation, approval, or missing business input.',
      schema: askUserToolInputSchema
    },
    async (input, ctx) => {
      try {
        const caller = readCallerScopeFromMcpContext(ctx);
        const isContinueWait = Object.keys(input).length === 0;

        if (isContinueWait) {
          const wait = await waitUntilTerminal(() =>
            service.wait({
              caller
            })
          );
          return object({ wait });
        }

        const createdQuestions = await service.askQuestions({
          caller,
          input
        });
        const wait = await waitUntilTerminal(() =>
          service.waitForQuestionIds({
            caller,
            questionIds: createdQuestions.map((question) => String(question.question_id))
          })
        );
        return object({ questions: createdQuestions, wait });
      } catch (err) {
        logger.warn('mcp_ask_user_failed', {
          tool_name: 'hitl_ask_user',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to ask and wait');
      }
    }
  );
}
