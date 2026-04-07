import { object, error, type MCPServer } from 'mcp-use/server';
import { cancelQuestionsInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import type { Logger } from '../../observability/logger';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerCancelQuestionsTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_cancel_questions',
      description: 'Cancel pending questions for the current caller scope.',
      schema: cancelQuestionsInputSchema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async (input, ctx) => {
      try {
        const result = await service.cancelQuestions({
          caller: readCallerScopeFromMcpContext(ctx),
          input
        });
        return object(result);
      } catch (err) {
        logger.warn('mcp_cancel_questions_failed', {
          tool_name: 'hitl_cancel_questions',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to cancel questions');
      }
    }
  );
}
