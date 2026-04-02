# hitl-mcp

一个面向 Agentic 系统的人类在环（Human-in-the-loop）MCP Server。

`hitl-mcp` 让 Agent 可以创建结构化问题组、按需等待，并且只在服务端通过 HTTP 完成最终答案提交后继续执行。

## 核心模型

- `agent_identity` 由 MCP 连接认证推导。
- `agent_session_id` 由连接级 header 推导，默认 `x-agent-session-id`。
- `question_group_id` 永远由服务端生成。
- 对同一个 `(agent_identity, agent_session_id)`，同时最多只有一个 `pending` 问题组。

这保证了问题组主键归服务端所有，同时又能按 Agent Session 做隔离。

## MCP 工具

- `hitl_create_question_group`
  创建 `pending` 问题组并立即返回。
- `hitl_wait_question_group`
  按 `question_group_id` 等待终态；如果不传 ID，则等待当前调用方作用域下唯一的 pending 问题组。
- `hitl_get_current_question_group`
  返回当前调用方作用域下的 pending 问题组。
- `hitl_get_question_group_status`
  按 ID 返回问题组状态。
- `hitl_get_question`
  按 `question_id` 返回题目定义。
- `hitl_cancel_question_group`
  取消 pending 问题组。

## HTTP API

- `GET /api/v1/healthz`
- `GET /api/v1/readyz`
- `GET /api/v1/metrics`
- `GET /api/v1/question-groups/current`
- `GET /api/v1/question-groups/{question_group_id}`
- `GET /api/v1/questions/{question_id}`
- `PUT /api/v1/question-groups/{question_group_id}/answers/finalize`
- `POST /api/v1/question-groups/{question_group_id}/cancel`
- `POST /api/v1/question-groups/{question_group_id}/expire`

当配置 `HITL_API_KEY` 后，受保护 HTTP 路由需要 `x-api-key`。`current` 路由还需要 `x-agent-session-id`。

## 端到端流程

1. Agent 调用 `hitl_create_question_group`。
2. 服务端认证调用方，读取 `x-agent-session-id`，生成 `question_group_id`，并把问题组落为 `pending`。
3. Agent 或后端保存返回的 `question_group_id`。
4. 当需要阻塞等待时，Agent 调用 `hitl_wait_question_group`。
5. 用户在你的 UI 中回答问题。
6. 后端通过 HTTP 提交最终答案。
7. 服务端校验答案，并将问题组切换到 `answered`、`cancelled` 或 `expired`。
8. 所有等待中的 MCP 调用都会收到终态结果。

## 配置

- `PORT`
- `MCP_URL`
- `HITL_PENDING_MAX_WAIT_SECONDS`
- `HITL_STORAGE`
- `HITL_REDIS_URL`
- `HITL_REDIS_PREFIX`
- `HITL_TTL_SECONDS`
- `HITL_API_KEY`
- `HITL_AGENT_AUTH_MODE`
- `HITL_AGENT_SESSION_HEADER`
- `HITL_CREATE_CONFLICT_POLICY`
- `HITL_SERVER_NAME`
- `HITL_SERVER_VERSION`
- `HITL_HTTP_HOST`
- `HITL_HTTP_API_PREFIX`
- `HITL_ANSWERED_RETENTION_SECONDS`
- `HITL_LOG_LEVEL`
- `HITL_ENABLE_METRICS`

优先级：

- `env`
- `.env`
- `config/hitl-mcp.yaml`
- 默认值

## 示例

创建问题组：

```json
{
  "title": "发布决策",
  "questions": [
    {
      "question_id": "q_canary",
      "type": "single_choice",
      "title": "是否开始金丝雀发布？",
      "options": [
        { "value": "yes", "label": "是" },
        { "value": "no", "label": "否" }
      ]
    }
  ]
}
```

等待当前问题组：

```json
{}
```

最终确认：

```bash
curl -X PUT "http://localhost:3000/api/v1/question-groups/<question_group_id>/answers/finalize" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${HITL_API_KEY}" \
  -d '{
    "idempotency_key": "idem-release-001",
    "answers": {
      "q_canary": { "value": "yes" }
    },
    "finalized_by": "release-orchestrator"
  }'
```
