import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerGetCurrentQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_get_current_request',
      description: 'Get the current pending request for the caller scope.',
      schema: z.object({})
    },
    async (_input, ctx) => {
      try {
        const result = await service.getCurrentRequest(readCallerScopeFromMcpContext(ctx));
        if (!result) return error('PENDING_REQUEST_NOT_FOUND');
        const { question_group_id, ...rest } = result as Record<string, unknown>;
        return object({ ...rest, request_id: question_group_id });
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to get current request');
      }
    }
  );
}
