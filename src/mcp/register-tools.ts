import type { MCPServer } from 'mcp-use/server';
import type { HitlService } from '../core/hitl-service.js';
import type { Logger } from '../observability/logger.js';
import { registerAskUserTool } from './tools/create-question-group.js';

export function registerHitlTools(server: MCPServer, service: HitlService, logger: Logger) {
  registerAskUserTool(server, service, logger);
}
