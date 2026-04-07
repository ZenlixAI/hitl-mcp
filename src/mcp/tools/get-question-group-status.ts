import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

const schema = z.object({
  request_id: z.string().min(1).describe('Request id')
});

export function registerGetQuestionGroupStatusTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_get_request_status',
      description: 'Get request status by request_id.',
      schema
    },
    async ({ request_id }) => {
      const result = await service.getRequestStatus(request_id);
      if (!result) return error('REQUEST_NOT_FOUND');
      const { question_group_id, ...rest } = result as Record<string, unknown>;
      return object({ ...rest, request_id: question_group_id });
    }
  );
}
