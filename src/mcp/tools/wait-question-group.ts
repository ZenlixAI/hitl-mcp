import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionGroupInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';

function readCaller(ctx: any) {
  return {
    agent_identity: String(ctx?.state?.get?.('agentIdentity') ?? ''),
    agent_session_id: String(ctx?.state?.get?.('agentSessionId') ?? '')
  };
}

export function registerWaitQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_wait_question_group',
      description: 'Wait for a question group to reach a terminal state.',
      schema: waitQuestionGroupInputSchema
    },
    async (input, ctx) => {
      try {
        return object(
          await service.waitQuestionGroup({
            caller: readCaller(ctx),
            question_group_id: input.question_group_id
          })
        );
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to wait for question group');
      }
    }
  );
}
