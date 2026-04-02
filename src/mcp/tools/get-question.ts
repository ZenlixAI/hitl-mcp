import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

const schema = z.object({
  question_id: z.string().min(1).describe('Question id')
});

export function registerGetQuestionTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_get_question',
      description: 'Get question detail by question_id.',
      schema
    },
    async ({ question_id }) => {
      const result = await service.getQuestion(question_id);
      if (!result) return error('QUESTION_NOT_FOUND');
      return object(result);
    }
  );
}
