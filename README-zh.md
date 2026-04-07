# hitl-mcp

用于 Agent 工作流的问答型人工干预服务（HITL MCP）。

## 对外模型

- 对外以 `question` 为基本操作单位
- 同一 caller scope 内可存在多个待处理问题
- 支持分批提交，服务端会累积并持久化进度
- 内部存储可能涉及分组，但这是实现细节，不会暴露在 MCP 工具或 HTTP API 中

caller scope 的范围由以下字段确定：

- `agent_identity`
- `agent_session_id`（默认从 `x-agent-session-id` 请求头读取）

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

- `terminal_only`：当 caller scope 内所有问题都处理完毕时，`wait` 才返回
- `progressive`：每个问题状态变化时都返回一次，调用方可继续调用 `wait` 进行监听

默认值：`terminal_only`

## 部分提交

`POST /api/v1/questions/answers` 和 `hitl_submit_answers` 支持以下参数：

- `answers`：待提交的问题答案（问题 ID 到答案的映射）
- `skipped_question_ids`：本次跳过的可选问题 ID 列表
- `idempotency_key`：可选，用于幂等性控制

每次提交仅处理指定的问题，服务端会累积保存进度，无需一次性回答所有问题。

`question_id` 由服务端自动生成，调用 `hitl_ask` 或 `POST /api/v1/questions` 时无需提供。

服务默认监听地址：`0.0.0.0:4000`

## 示例

创建问题：

```json
{
  "title": "发布决策",
  "questions": [
    {
      "type": "single_choice",
      "title": "是否开始金丝雀发布？",
      "options": [
        { "value": "yes", "label": "是" },
        { "value": "no", "label": "否" }
      ]
    },
    {
      "type": "text",
      "title": "还有补充吗？",
      "required": false
    }
  ]
}
```

响应中包含服务端生成的 `question_id`，后续提交、取消或查询操作都需要使用这些 ID。

分批提交：

```bash
curl -X POST "http://localhost:4000/api/v1/questions/answers" \
  -H "Content-Type: application/json" \
  -H "x-agent-identity: api_key:test-agent" \
  -H "x-agent-session-id: session-123" \
  -d '{
    "answers": {
      "q_canary": { "value": "yes" }
    }
  }'
```

## 配置说明

- `PORT` - 服务端口
- `MCP_URL` - MCP 服务地址
- `HITL_PENDING_MAX_WAIT_SECONDS` - 待处理问题最大等待时间
- `HITL_WAIT_MODE` - Wait 模式，可选值：`terminal_only` | `progressive`
- `HITL_STORAGE` - 存储类型，可选值：`memory` | `redis`
- `HITL_REDIS_URL` - Redis 连接地址
- `HITL_REDIS_PREFIX` - Redis 键前缀
- `HITL_TTL_SECONDS` - 数据过期时间
- `HITL_ANSWERED_RETENTION_SECONDS` - 已回答问题保留时间
- `HITL_API_KEY` - API 访问密钥
- `HITL_AGENT_AUTH_MODE` - Agent 认证模式
- `HITL_AGENT_SESSION_HEADER` - Agent 会话 ID 请求头名称
- `HITL_CREATE_CONFLICT_POLICY` - 创建冲突时的处理策略
- `HITL_SERVER_NAME` - 服务器名称
- `HITL_SERVER_VERSION` - 服务器版本
- `HITL_HTTP_HOST` - HTTP 主机名
- `HITL_HTTP_API_PREFIX` - HTTP API 路径前缀
- `HITL_LOG_LEVEL` - 日志级别
- `HITL_ENABLE_METRICS` - 是否启用指标收集

## 开发使用

```bash
npm install
npm test
npm run dev
```

## 相关文档

- [MCP 工具](docs/api/mcp-tools.md)
- [HTTP API](docs/api/http-openapi.md)
- [HITL Skill](skills/hitl/SKILL.md)
