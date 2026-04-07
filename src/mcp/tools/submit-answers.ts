import { object, error, type MCPServer } from 'mcp-use/server';
import { submitAnswersInputSchema } from '../../domain/schemas';
import type { HitlService } from '../../core/hitl-service';
import { readCallerScopeFromMcpContext } from '../caller-scope';

export function registerSubmitAnswersTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_submit_answers',
      description: 'Submit answers or skips for pending questions in the current caller scope.',
      schema: submitAnswersInputSchema,
      annotations: {
        destructiveHint: false,
        readOnlyHint: false,
        openWorldHint: false
      }
    },
    async (input, ctx) => {
      try {
        const result = await service.submitAnswers({
          caller: readCallerScopeFromMcpContext(ctx),
          input
        });
        return object(result);
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to submit answers');
      }
    }
  );
}
