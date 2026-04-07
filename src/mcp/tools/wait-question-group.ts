import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionGroupInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerWaitQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_wait_request',
      description: 'Wait for a request to reach a terminal state.',
      schema: waitQuestionGroupInputSchema
    },
    async (input, ctx) => {
      try {
        const result = await service.waitRequest({
          caller: readCallerScopeFromMcpContext(ctx),
          request_id: input.request_id
        });
        const { question_group_id, ...rest } = result as Record<string, unknown>;
        return object({ ...rest, request_id: question_group_id });
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to wait for request');
      }
    }
  );
}
