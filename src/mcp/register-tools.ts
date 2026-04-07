import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service';
import { registerAskTool } from './tools/create-question-group';
import { registerGetPendingQuestionsTool } from './tools/get-current-question-group';
import { registerGetQuestionTool } from './tools/get-question';
import { registerWaitTool } from './tools/wait-question-group';
import { registerCancelQuestionsTool } from './tools/cancel-question-group';
import { registerSubmitAnswersTool } from './tools/submit-answers';

export function registerHitlTools(server: MCPServer, service: HitlService) {
  registerAskTool(server, service);
  registerWaitTool(server, service);
  registerGetPendingQuestionsTool(server, service);
  registerGetQuestionTool(server, service);
  registerCancelQuestionsTool(server, service);
  registerSubmitAnswersTool(server, service);
}
