import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service.js';
import type { Logger } from '../observability/logger.js';
import { registerAskTool } from './tools/create-question-group.js';
import { registerGetPendingQuestionsTool } from './tools/get-current-question-group.js';
import { registerGetQuestionTool } from './tools/get-question.js';
import { registerWaitTool } from './tools/wait-question-group.js';
import { registerCancelQuestionsTool } from './tools/cancel-question-group.js';
import { registerSubmitAnswersTool } from './tools/submit-answers.js';

export function registerHitlTools(server: MCPServer, service: HitlService, logger: Logger) {
  registerAskTool(server, service, logger);
  registerWaitTool(server, service, logger);
  registerGetPendingQuestionsTool(server, service, logger);
  registerGetQuestionTool(server, service, logger);
  registerCancelQuestionsTool(server, service, logger);
  registerSubmitAnswersTool(server, service, logger);
}
