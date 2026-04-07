# hitl-mcp

面向 Agent 工作流的 question-only HITL MCP 服务。

## 对外模型

- 对外只暴露 `question`
- 同一个 caller scope 下允许同时存在多个 pending questions
- 支持部分提交，服务端累积持久化进度
- 内部如果仍然保留分组，只作为存储实现细节，不出现在 MCP 和 HTTP API 中

caller scope 由以下字段确定：

- `agent_identity`
- `agent_session_id`，默认从 `x-agent-session-id` 读取

## MCP 工具

- `hitl_ask`
- `hitl_wait`
- `hitl_get_pending_questions`
- `hitl_submit_answers`
- `hitl_cancel_questions`
- `hitl_get_question`

## HTTP API

- `POST /api/v1/questions`
- `GET /api/v1/questions/pending`
- `POST /api/v1/questions/answers`
- `POST /api/v1/questions/cancel`
- `GET /api/v1/questions/:question_id`

## Wait 模式

通过 `HITL_WAIT_MODE` 配置：

- `terminal_only`：只有当当前 caller scope 下没有 pending questions 时，`wait` 才返回
- `progressive`：每次问题状态变化都返回一次，调用方可继续发起下一次 `wait`

默认值：`terminal_only`

## 部分提交

`POST /api/v1/questions/answers` 和 `hitl_submit_answers` 支持：

- `answers`：本次新回答的一部分问题
- `skipped_question_ids`：本次显式忽略的一部分可选问题
- `idempotency_key`：可选

每次提交都会累积保存，不要求一次性答完所有问题。

## 示例

创建问题：

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
    },
    {
      "question_id": "q_note",
      "type": "text",
      "title": "还有补充吗？",
      "required": false
    }
  ]
}
```

部分提交：

```bash
curl -X POST "http://localhost:3000/api/v1/questions/answers" \
  -H "Content-Type: application/json" \
  -H "x-agent-identity: api_key:test-agent" \
  -H "x-agent-session-id: session-123" \
  -d '{
    "answers": {
      "q_canary": { "value": "yes" }
    }
  }'
```

## 配置

- `PORT`
- `MCP_URL`
- `HITL_PENDING_MAX_WAIT_SECONDS`
- `HITL_WAIT_MODE=terminal_only|progressive`
- `HITL_STORAGE=memory|redis`
- `HITL_REDIS_URL`
- `HITL_REDIS_PREFIX`
- `HITL_TTL_SECONDS`
- `HITL_ANSWERED_RETENTION_SECONDS`
- `HITL_API_KEY`
- `HITL_AGENT_AUTH_MODE`
- `HITL_AGENT_SESSION_HEADER`
- `HITL_CREATE_CONFLICT_POLICY`
- `HITL_SERVER_NAME`
- `HITL_SERVER_VERSION`
- `HITL_HTTP_HOST`
- `HITL_HTTP_API_PREFIX`
- `HITL_LOG_LEVEL`
- `HITL_ENABLE_METRICS`

## 开发

```bash
npm install
npm test
npm run dev
```

## 文档

- [MCP 工具](docs/api/mcp-tools.md)
- [HTTP API](docs/api/http-openapi.md)
- [HITL Skill](skills/hitl/SKILL.md)
