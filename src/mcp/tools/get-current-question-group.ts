import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';
import type { HitlService } from '../../core/hitl-service';

function readCaller(ctx: any) {
  return {
    agent_identity: String(ctx?.state?.get?.('agentIdentity') ?? ''),
    agent_session_id: String(ctx?.state?.get?.('agentSessionId') ?? '')
  };
}

export function registerGetCurrentQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_get_current_question_group',
      description: 'Get the current pending question group for the caller scope.',
      schema: z.object({})
    },
    async (_input, ctx) => {
      const result = await service.getCurrentQuestionGroup(readCaller(ctx));
      if (!result) return error('PENDING_GROUP_NOT_FOUND');
      return object(result);
    }
  );
}
