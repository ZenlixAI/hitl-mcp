import { object, error, type MCPServer } from 'mcp-use/server';
import { createQuestionGroupInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerCreateQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_create_question_group',
      description:
        'Create a pending question group for the current authenticated agent identity and session.',
      schema: createQuestionGroupInputSchema
    },
    async (input, ctx) => {
      try {
        return object(
          await service.createQuestionGroup({
            caller: readCallerScopeFromMcpContext(ctx),
            input
          })
        );
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to create question group');
      }
    }
  );
}
