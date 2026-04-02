# hitl-mcp

生产级 Human-in-the-loop MCP Server。

核心能力：
- Agent 通过 `hitl_ask_question_group` 发起结构化问题组。
- 在收到 HTTP finalize 之前，提问调用保持 pending。
- HTTP 控制面按 `question_group_id` / `question_id` 操作（无 list）。
- 支持内存仓储与 Redis 仓储切换。

## 快速开始

```bash
npm install
npm run dev
```

默认端口 `3000`。

## 环境变量

- `PORT`: 服务端口（默认 `3000`）
- `MCP_URL`: MCP 基础 URL（默认 `http://localhost:3000`）
- `HITL_PENDING_MAX_WAIT_SECONDS`: MCP 阻塞等待最大秒数，`0` 表示无限等待
- `HITL_STORAGE`: `memory`(默认) 或 `redis`
- `HITL_REDIS_URL`: Redis 连接串（默认 `redis://127.0.0.1:6379`）
- `HITL_REDIS_PREFIX`: Redis key 前缀（默认 `hitl`）
- `HITL_TTL_SECONDS`: TTL 秒数（默认 `604800`）
- `HITL_API_KEY`: 设置后启用 HTTP API key 鉴权（请求头 `x-api-key`）

## MCP Tools

- `hitl_ask_question_group`: 发起问题组并阻塞等待最终答案
- `hitl_get_question_group_status`: 查询问题组状态
- `hitl_get_question`: 按 `question_id` 查询题目
- `hitl_cancel_question_group`: 取消 pending 问题组

详细契约见 [docs/api/mcp-tools.md](docs/api/mcp-tools.md)

## HTTP API

- `GET /api/v1/healthz`
- `GET /api/v1/question-groups/{question_group_id}`
- `GET /api/v1/questions/{question_id}`
- `PUT /api/v1/question-groups/{question_group_id}/answers/finalize`
- `POST /api/v1/question-groups/{question_group_id}/cancel`
- `POST /api/v1/question-groups/{question_group_id}/expire`

详细契约见 [docs/api/http-openapi.md](docs/api/http-openapi.md)

## 测试

```bash
npm run test
```

