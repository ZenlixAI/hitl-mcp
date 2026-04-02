import { MCPServer } from 'mcp-use/server';
import { HitlService } from './src/core/hitl-service';
import { requestIdMiddleware } from './src/http/middleware/request-id';
import { questionRoutes } from './src/http/routes/questions';
import { questionGroupRoutes } from './src/http/routes/question-groups';
import { ok } from './src/http/response';
import { registerHitlTools } from './src/mcp/register-tools';
import { Waiter } from './src/state/waiter';
import { InMemoryHitlRepository } from './src/storage/in-memory-repository';

const server = new MCPServer({
  name: 'hitl-mcp',
  title: 'HITL MCP',
  version: '0.1.0',
  description: 'Human-in-the-loop MCP server with HTTP control plane.',
  baseUrl: process.env.MCP_URL || 'http://localhost:3000',
  favicon: 'favicon.ico',
  icons: [
    {
      src: 'icon.svg',
      mimeType: 'image/svg+xml',
      sizes: ['512x512']
    }
  ]
});

const repository = new InMemoryHitlRepository();
const waiter = new Waiter();
const service = new HitlService(
  repository,
  waiter,
  Number(process.env.HITL_PENDING_MAX_WAIT_SECONDS || '0')
);

registerHitlTools(server, service);

server.use(requestIdMiddleware);
server.app.get('/api/v1/healthz', (c) => {
  return c.json(ok(c.get('requestId') ?? 'local', { status: 'ok' }));
});
server.app.route('/api/v1', questionGroupRoutes({ repository, waiter }));
server.app.route('/api/v1', questionRoutes({ repository }));

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
server.listen(PORT);
