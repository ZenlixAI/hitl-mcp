import { object, error, type MCPServer } from 'mcp-use/server';
import { askQuestionsInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

export function registerAskTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_ask',
      description: 'Create one or more pending questions for the current caller scope.',
      schema: askQuestionsInputSchema
    },
    async (input, ctx) => {
      try {
        const questions = await service.askQuestions({
          caller: readCallerScopeFromMcpContext(ctx),
          input
        });
        return object({ questions });
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
