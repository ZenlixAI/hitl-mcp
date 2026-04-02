import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

const schema = z.object({
  question_group_id: z.string().min(1).describe('Question group id')
});

export function registerGetQuestionGroupStatusTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_get_question_group_status',
      description: 'Get question group status by question_group_id.',
      schema
    },
    async ({ question_group_id }) => {
      const result = await service.getQuestionGroupStatus(question_group_id);
      if (!result) return error('QUESTION_GROUP_NOT_FOUND');
      return object(result);
    }
  );
}
