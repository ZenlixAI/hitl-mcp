import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionsInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

export function registerWaitTool(server: MCPServer, service: HitlService, logger: Logger) {
  server.tool(
    {
      name: 'hitl_wait',
      description: 'Wait for pending questions in the current caller scope to change or complete.',
      schema: waitQuestionsInputSchema
    },
    async (_input, ctx) => {
      const startedAt = Date.now();
      let progressInFlight = false;
      const progressTimer = setInterval(() => {
        if (progressInFlight) return;
        progressInFlight = true;

        void (async () => {
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          const progressMessage = 'Waiting for human input';
          const caller = readCallerScopeFromMcpContext(ctx);

          try {
            await ctx?.reportProgress?.(
              elapsedSeconds,
              undefined,
              progressMessage
            );
            logger.info('mcp_wait_progress_sent', {
              tool_name: 'hitl_wait',
              agent_identity: caller.agent_identity,
              agent_session_id: caller.agent_session_id,
              progress: elapsedSeconds,
              elapsed_seconds: elapsedSeconds,
              progress_message: progressMessage
            });
          } catch (error) {
            logger.warn('mcp_wait_progress_failed', {
              tool_name: 'hitl_wait',
              agent_identity: caller.agent_identity,
              agent_session_id: caller.agent_session_id,
              progress: elapsedSeconds,
              elapsed_seconds: elapsedSeconds,
              progress_message: progressMessage,
              error
            });
          } finally {
            progressInFlight = false;
          }
        })();
      }, 30_000);

      try {
        const result = await service.wait({
          caller: readCallerScopeFromMcpContext(ctx)
        });
        return object(result);
      } catch (err) {
        logger.warn('mcp_wait_failed', {
          tool_name: 'hitl_wait',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to wait for questions');
      } finally {
        clearInterval(progressTimer);
      }
    }
  );
}
