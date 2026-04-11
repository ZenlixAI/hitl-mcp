import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionsInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

export function registerWaitTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_wait',
      description: 'Wait for pending questions in the current caller scope to change or complete.',
      schema: waitQuestionsInputSchema
    },
    async (_input, ctx) => {
      try {
        const result = await service.wait({
          caller: readCallerScopeFromMcpContext(ctx)
        });
        return object(result);
      } catch (err) {
        logger.warn('mcp_wait_failed', {
          tool_name: 'hitl_wait',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to wait for questions');
      }
    }
  );
}
