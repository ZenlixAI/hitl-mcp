import { object, error, type MCPServer } from 'mcp-use/server';
import { createRequestInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerCreateQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_create_request',
      description:
        'Create a pending human-input request for the current authenticated agent identity and session.',
      schema: createRequestInputSchema
    },
    async (input, ctx) => {
      try {
        const created = await service.createRequest({
          caller: readCallerScopeFromMcpContext(ctx),
          input
        });
        const { question_group_id, ...rest } = created as Record<string, unknown>;
        return object({
          ...rest,
          request_id: question_group_id
        });
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to create request');
      }
    }
  );
}
