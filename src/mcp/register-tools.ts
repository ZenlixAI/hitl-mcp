import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service';
import { registerAskQuestionGroupTool } from './tools/ask-question-group';
import { registerGetQuestionGroupStatusTool } from './tools/get-question-group-status';
import { registerGetQuestionTool } from './tools/get-question';
import { registerCancelQuestionGroupTool } from './tools/cancel-question-group';

export function registerHitlTools(server: MCPServer, service: HitlService) {
  registerAskQuestionGroupTool(server, service);
  registerGetQuestionGroupStatusTool(server, service);
  registerGetQuestionTool(server, service);
  registerCancelQuestionGroupTool(server, service);
}
