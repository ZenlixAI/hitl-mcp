import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionsInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerWaitTool(server: MCPServer, service: HitlService) {
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
        return error(err instanceof Error ? err.message : 'failed to wait for questions');
      }
    }
  );
}
