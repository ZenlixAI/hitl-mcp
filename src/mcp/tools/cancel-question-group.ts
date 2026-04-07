import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

const schema = z.object({
  request_id: z.string().min(1).describe('Request id'),
  reason: z.string().optional().describe('Optional cancel reason')
});

export function registerCancelQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_cancel_request',
      description: 'Cancel a pending request by request_id.',
      schema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async ({ request_id, reason }) => {
      try {
        const result = await service.cancelRequest(request_id, reason);
        return object(result);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to cancel request');
      }
    }
  );
}
