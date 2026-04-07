import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';
import type { Logger } from '../../observability/logger';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerGetPendingQuestionsTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_get_pending_questions',
      description: 'Get all pending questions for the current caller scope.',
      schema: z.object({})
    },
    async (_input, ctx) => {
      try {
        const pendingQuestions = await service.getPendingQuestions(readCallerScopeFromMcpContext(ctx));
        return object({ pending_questions: pendingQuestions });
      } catch (err) {
        logger.warn('mcp_get_pending_questions_failed', {
          tool_name: 'hitl_get_pending_questions',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to get pending questions');
      }
    }
  );
}
