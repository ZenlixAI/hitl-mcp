import { object, error, type MCPServer } from 'mcp-use/server';
import { askQuestionGroupInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';

export function registerAskQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_ask_question_group',
      description: 'Create a question group and wait until final answers are submitted.',
      schema: askQuestionGroupInputSchema
    },
    async (input) => {
      try {
        const result = await service.askQuestionGroup(input);
        return object(result);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to ask question group');
      }
    }
  );
}
