import { object, error, type MCPServer } from 'mcp-use/server';
import { createQuestionGroupInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';

function readCaller(ctx: any) {
  return {
    agent_identity: String(ctx?.state?.get?.('agentIdentity') ?? ''),
    agent_session_id: String(ctx?.state?.get?.('agentSessionId') ?? '')
  };
}

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
        return object(await service.createQuestionGroup({ caller: readCaller(ctx), input }));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to create question group');
      }
    }
  );
}
