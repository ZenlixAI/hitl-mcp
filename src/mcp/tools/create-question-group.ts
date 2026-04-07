import { object, error, type MCPServer } from 'mcp-use/server';
import { askQuestionsInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerAskTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_ask',
      description: 'Create one or more pending questions for the current caller scope.',
      schema: askQuestionsInputSchema
    },
    async (input, ctx) => {
      try {
        const questions = await service.askQuestions({
          caller: readCallerScopeFromMcpContext(ctx),
          input
        });
        return object({ questions });
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to ask questions');
      }
    }
  );
}
