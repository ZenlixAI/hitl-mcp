import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service';
import type { Logger } from '../observability/logger';
import { registerAskTool } from './tools/create-question-group';
import { registerGetPendingQuestionsTool } from './tools/get-current-question-group';
import { registerGetQuestionTool } from './tools/get-question';
import { registerWaitTool } from './tools/wait-question-group';
import { registerCancelQuestionsTool } from './tools/cancel-question-group';
import { registerSubmitAnswersTool } from './tools/submit-answers';

export function registerHitlTools(server: MCPServer, service: HitlService, logger: Logger) {
  registerAskTool(server, service, logger);
  registerWaitTool(server, service, logger);
  registerGetPendingQuestionsTool(server, service, logger);
  registerGetQuestionTool(server, service, logger);
  registerCancelQuestionsTool(server, service, logger);
  registerSubmitAnswersTool(server, service, logger);
}
