import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

const schema = z.object({
  question_group_id: z.string().min(1).describe('Question group id'),
  reason: z.string().optional().describe('Optional cancel reason')
});

export function registerCancelQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_cancel_question_group',
      description: 'Cancel a pending question group by question_group_id.',
      schema,
      annotations: {
        destructiveHint: true,
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async ({ question_group_id, reason }) => {
      try {
        const result = await service.cancelQuestionGroup(question_group_id, reason);
        return object(result);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to cancel question group');
      }
    }
  );
}
