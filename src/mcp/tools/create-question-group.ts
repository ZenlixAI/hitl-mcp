import { object, error, type MCPServer } from 'mcp-use/server';
import { askQuestionsInputSchema } from '../../domain/schemas.js';
import type { HitlService } from '../../core/hitl-service.js';
import type { Logger } from '../../observability/logger.js';
import { readCallerScopeFromMcpContext } from '../caller-scope.js';

export function registerAskTool(
  server: MCPServer,
  service: HitlService,
  logger: Logger,
  options: { defaultTimeoutSeconds: number }
) {
  server.tool(
    {
      name: 'hitl_ask',
      description:
        'Create one or more pending questions for the current caller scope. ' +
        'Prefer setting explicit default_answer values when possible. ' +
        'If default_answer is provided, default_answer.value must match the question type: ' +
        'single_choice must equal one of options[].value; ' +
        'multi_choice must be a string[] of options[].value; ' +
        'text must be a string; boolean must be true or false; range must be a number within bounds. ' +
        'single_choice options may declare followup_fields, and selected followup values are submitted later via answers[question_id].fields. ' +
        'If omitted, the server derives a default answer per question type. ' +
        `The current default timeout is ${options.defaultTimeoutSeconds} seconds unless timeout_seconds is provided.`,
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
        logger.warn('mcp_ask_failed', {
          tool_name: 'hitl_ask',
          error: err
        });
        return error(err instanceof Error ? err.message : 'failed to ask questions');
      }
    }
  );
}
