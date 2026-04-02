import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service';
import { registerCreateQuestionGroupTool } from './tools/create-question-group';
import { registerGetQuestionGroupStatusTool } from './tools/get-question-group-status';
import { registerGetQuestionTool } from './tools/get-question';
import { registerGetCurrentQuestionGroupTool } from './tools/get-current-question-group';
import { registerWaitQuestionGroupTool } from './tools/wait-question-group';
import { registerCancelQuestionGroupTool } from './tools/cancel-question-group';

export function registerHitlTools(server: MCPServer, service: HitlService) {
  registerCreateQuestionGroupTool(server, service);
  registerWaitQuestionGroupTool(server, service);
  registerGetCurrentQuestionGroupTool(server, service);
  registerGetQuestionGroupStatusTool(server, service);
  registerGetQuestionTool(server, service);
  registerCancelQuestionGroupTool(server, service);
}
