# hitl-mcp 产品技术设计文档

> 注意：该文档描述的是 2026-04-01 的早期阻塞式 `hitl_ask_question_group` 方案。当前实现已经切换为服务端生成 `question_group_id`、连接认证识别 `agent_identity`、连接 header 识别 `agent_session_id`、以及 `create / wait / get_current` 工具模型。阅读当前行为请以 [README.md](/var/folders/g4/bhx1x1vn0wld0v_hx35m109w0000gn/T/vibe-kanban/worktrees/b602-/hitl-mcp/README.md) 与 [docs/api/mcp-tools.md](/var/folders/g4/bhx1x1vn0wld0v_hx35m109w0000gn/T/vibe-kanban/worktrees/b602-/hitl-mcp/docs/api/mcp-tools.md) 为准。

## 1. 文档信息
- 项目：`hitl-mcp`
- 文档版本：`v0.1`
- 日期：`2026-04-01`
- 状态：`设计草案（待评审）`

## 2. 背景与问题定义
在复杂 Agentic 场景中，Agent 需要向用户提问并等待回复。现有方式存在以下缺陷：
- 直接 assistant message 提问：缺少结构化数据，客户端无法稳定渲染问题卡片。
- 参考实现（ask-user-questions-mcp）偏 CLI/TUI：
  - UI 与 MCP server 耦合；
  - 无 HTTP 管控面，服务端集成成本高；
  - 消息缺少稳定 `question_id` / `question_group_id`；
  - 用户回复被本地消费，不利于服务端后处理；
  - 全局持久化能力不足。

`hitl-mcp` 的目标是：将“提问/等待/收答/确认”做成可生产部署、可扩展、可持久化、可被 Web/多端集成的 MCP 服务。

## 3. 目标与非目标

### 3.1 目标
- 提供基于 MCP 的结构化提问能力，且永远以 `question_group` 为单位。
- 支持题型：单选、多选、输入、判断、范围值。
- 支持必答（默认）/可选题。
- `question_group` 与 `question` 均支持：`title`、`description?(markdown)`、`tags?`、`extra?(object)`。
- MCP 交互中始终带 `question_group_id` 与 `question_id`。
- 支持跨 session 状态持久化，使用 Redis（KV）并支持 TTL。
- 提供 HTTP 管控面 API（不提供任何 List 操作）。
- 配置支持四级优先级：环境变量 > `.env` > YAML > 默认值。
- Agent 发起提问后保持 pending，直到 HTTP API 提交最终答案才结束。

### 3.2 非目标
- 不实现客户端 UI（卡片渲染由 agent client 完成）。
- 不实现“client -> agent server”的旁路消息协议。
- 不依赖关系型数据库。

## 4. 设计原则
- 单一职责：MCP 负责“提问协议与等待”，HTTP 负责“管控与提交最终答案”。
- 强约束 ID：所有状态变更必须通过 `question_group_id` 或 `question_id`。
- 幂等优先：关键写操作必须支持幂等键，避免重复提交。
- 可观测优先：状态机迁移、校验失败、超时与取消可追踪。
- 可恢复：进程重启后可从 Redis 恢复 pending 状态。

## 5. 方案比较与选型

### 方案 A：阻塞式 MCP Tool（推荐）
- Agent 调用 MCP tool 提交 `question_group` 后，tool 调用保持挂起。
- 用户最终答案通过 HTTP API 写入后，tool 才返回。
- 优点：
  - 完全符合“未收到最终答案不回复”的硬约束；
  - Agent 会话天然处于 pending；
  - 协议简单，Agent 端心智负担低。
- 缺点：
  - 长连接/长任务管理复杂；
  - 需要处理超时、断连与恢复。

### 方案 B：非阻塞式双 Tool
- `create_question_group` 立即返回，`await_question_group` 单独等待。
- 优点：连接压力更低，职责更细。
- 缺点：编排复杂，Agent 容易漏调 `await`，不满足“提问后即 pending”的强语义。

### 方案 C：纯异步事件回调
- MCP 只创建任务，结果通过事件流回调，不阻塞 tool。
- 优点：吞吐高。
- 缺点：与多数 MCP 客户端行为不一致，集成复杂度高。

### 选型结论
采用 **方案 A（阻塞式 MCP Tool）**。

## 6. 系统架构

### 6.1 组件
- `MCP Runtime`（mcp-use）：
  - 提供 `server.tool()`。
  - 处理提问、等待、返回确认结果。
- `HTTP Control Plane`（Hono）：
  - 接收服务端后处理后的最终答案；
  - 提供按 ID 的查询/操作接口；
  - 不提供 list。
- `Redis`：
  - 存储问题组、题目、答案、状态、幂等记录、事件唤醒键。
- `Config Loader`：
  - 合并四级配置来源。

### 6.2 高层时序
1. Agent 调用 `hitl_ask_question_group`（携带完整 question group）。
2. `hitl-mcp` 校验并写入 Redis，状态置为 `pending`。
3. tool 挂起等待（直到收到 HTTP 最终答案）。
4. 用户通过客户端完成交互，agent server 后处理。
5. agent server 调用 HTTP `finalize` 接口提交最终答案。
6. `hitl-mcp` 校验答案；若不完整/格式错误返回可读错误并保持 pending。
7. 全部合法后状态置 `answered`，唤醒 MCP tool。
8. tool 返回确认消息（含 group/question IDs + 最终答案摘要）。

## 7. 领域模型与状态机

### 7.1 核心实体
- `QuestionGroup`
  - `question_group_id` (string, 全局唯一)
  - `title` (string)
  - `description?` (markdown)
  - `tags?` (string[])
  - `extra?` (object)
  - `questions` (Question[])
  - `status` (`pending` | `answered` | `cancelled` | `expired`)
  - `created_at` / `updated_at` / `expires_at`
- `Question`
  - `question_id` (string, 全局唯一)
  - `group_id` (string)
  - `type` (`single_choice` | `multi_choice` | `text` | `boolean` | `range`)
  - `required` (boolean, 默认 true)
  - `title` / `description?` / `tags?` / `extra?`
  - 类型特定约束（见 8.2）
- `AnswerSet`
  - `group_id`
  - `answers` (按 `question_id` 索引)
  - `validation_errors?`
  - `finalized_by`
  - `finalized_at`

### 7.2 状态机
- `pending`：已发问，等待最终答案。
- `answered`：所有必答题合法，已完成。
- `cancelled`：外部取消。
- `expired`：TTL 到期或主动过期。

状态迁移：
- `pending -> answered`：`finalize` 校验通过。
- `pending -> cancelled`：取消接口。
- `pending -> expired`：TTL 到期。
- 终态（`answered/cancelled/expired`）不可回退。

## 8. MCP Tool 设计（重点）

> 设计约束：始终以 Question Group 发问；阻塞直到 HTTP `finalize` 成功。

### 8.1 Tool 列表
1. `hitl_ask_question_group`（核心）
2. `hitl_get_question_group_status`（按 group_id 查询）
3. `hitl_get_question`（按 question_id 查询）
4. `hitl_cancel_question_group`（按 group_id 取消，可选）

说明：不提供 list 类 tool。

### 8.2 `hitl_ask_question_group` 输入 schema（摘要）
```json
{
  "question_group_id": "string",
  "title": "string",
  "description": "string? (markdown)",
  "tags": ["string"],
  "extra": {},
  "ttl_seconds": 86400,
  "questions": [
    {
      "question_id": "string",
      "type": "single_choice|multi_choice|text|boolean|range",
      "required": true,
      "title": "string",
      "description": "string?",
      "tags": ["string"],
      "extra": {},
      "options": [
        {"value": "string", "label": "string", "description": "string?"}
      ],
      "text_constraints": {"min_length": 0, "max_length": 5000, "pattern": "regex?"},
      "range_constraints": {"min": 0, "max": 100, "step": 1}
    }
  ],
  "idempotency_key": "string?",
  "metadata": {
    "agent_session_id": "string?",
    "agent_trace_id": "string?"
  }
}
```

字段约束：
- `required` 默认 `true`。
- `single_choice`：`options` 必须 >= 1，答案必须 1 个。
- `multi_choice`：`options` 必须 >= 1，可配置 min/max 选择数（可扩展）。
- `text`：应用 `text_constraints`。
- `boolean`：答案仅允许 true/false。
- `range`：应用 `range_constraints` 且满足 step。

### 8.3 `hitl_ask_question_group` 行为
- 校验 schema 与业务约束。
- 写入 Redis（group + questions + pending state + TTL）。
- 若 `idempotency_key` 命中：返回已存在的同请求结果（幂等）。
- 进入等待：阻塞当前 tool 调用，直到：
  - 收到 HTTP 最终答案并校验通过 -> 返回 `answered`；
  - 取消/过期 -> 返回 `cancelled/expired`。

### 8.4 `hitl_ask_question_group` 返回（最终解挂后）
```json
{
  "question_group_id": "qg_123",
  "status": "answered",
  "answered_at": "2026-04-01T12:34:56Z",
  "answers": {
    "q_1": {"type": "single_choice", "value": "A"},
    "q_2": {"type": "text", "value": "..."}
  },
  "summary": "All required questions are answered and validated."
}
```

### 8.5 其他 MCP Tools
- `hitl_get_question_group_status`
  - 入参：`question_group_id`
  - 出参：`status` + `missing_required_question_ids` + `updated_at`
- `hitl_get_question`
  - 入参：`question_id`
  - 出参：题目定义 + 当前回答状态
- `hitl_cancel_question_group`
  - 入参：`question_group_id`, `reason?`
  - 出参：取消确认

## 9. HTTP API 设计（重点）

### 9.1 约束
- 不提供 list API。
- 所有接口路径必须携带 `question_group_id` 或 `question_id`。
- 响应统一结构：
```json
{
  "request_id": "req_xxx",
  "success": true,
  "data": {},
  "error": null
}
```

### 9.2 API 一览
1. `GET /api/v1/question-groups/{question_group_id}`
2. `GET /api/v1/questions/{question_id}`
3. `PUT /api/v1/question-groups/{question_group_id}/answers/finalize`
4. `PATCH /api/v1/question-groups/{question_group_id}/answers`（可选，提交草稿/部分答案）
5. `POST /api/v1/question-groups/{question_group_id}/cancel`
6. `POST /api/v1/question-groups/{question_group_id}/expire`（可选）
7. `GET /api/v1/healthz`（健康检查，非业务 list）

### 9.3 Finalize 接口（核心）
`PUT /api/v1/question-groups/{question_group_id}/answers/finalize`

请求体：
```json
{
  "idempotency_key": "idem_xxx",
  "answers": {
    "q_1": {"value": "A"},
    "q_2": {"value": ["B", "C"]},
    "q_3": {"value": true},
    "q_4": {"value": 42},
    "q_5": {"value": "free text"}
  },
  "finalized_by": "agent-server",
  "extra": {}
}
```

成功响应（200）：
```json
{
  "request_id": "req_123",
  "success": true,
  "data": {
    "question_group_id": "qg_123",
    "status": "answered",
    "answered_question_ids": ["q_1", "q_2", "q_3"],
    "answered_at": "2026-04-01T12:34:56Z"
  },
  "error": null
}
```

校验失败响应（422）：
```json
{
  "request_id": "req_456",
  "success": false,
  "data": {
    "question_group_id": "qg_123",
    "status": "pending"
  },
  "error": {
    "code": "ANSWER_VALIDATION_FAILED",
    "message": "2 个问题未通过校验，请修正后重试。",
    "details": [
      {
        "question_id": "q_2",
        "reason": "必须至少选择 1 项",
        "expected": "non-empty array"
      },
      {
        "question_id": "q_4",
        "reason": "数值超出范围",
        "expected": "0 <= value <= 100"
      }
    ]
  }
}
```

行为要求：
- 仅当必答题全部通过时，状态切换到 `answered` 并唤醒 MCP pending 调用。
- 校验失败时不唤醒，保持 `pending`。
- 幂等键重复提交返回同结果。

### 9.4 错误码规范
- `QUESTION_GROUP_NOT_FOUND` (404)
- `QUESTION_NOT_FOUND` (404)
- `QUESTION_GROUP_NOT_PENDING` (409)
- `ANSWER_VALIDATION_FAILED` (422)
- `IDEMPOTENCY_CONFLICT` (409)
- `REQUEST_EXPIRED` (410)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `INTERNAL_ERROR` (500)

## 10. Redis 数据模型与 TTL

### 10.1 Key 设计
- `hitl:qg:{group_id}` -> QuestionGroup（Hash/JSON）
- `hitl:q:{question_id}` -> Question（Hash/JSON）
- `hitl:ans:{group_id}` -> AnswerSet（Hash/JSON）
- `hitl:wait:{group_id}` -> 等待信号（PubSub channel 或 stream pointer）
- `hitl:idem:{scope}:{idempotency_key}` -> 幂等记录
- `hitl:idx:q2g:{question_id}` -> question_id 到 group_id 索引

### 10.2 TTL 策略
- Group/Question/Answer 使用同一 TTL 窗口（默认 7d，可配置）。
- `answered` 后可配置延长保留（如 30d）用于审计与回放。
- 过期后状态视为 `expired`。

### 10.3 并发控制
- 使用 Redis 分布式锁（短租期 + 自动续租）保护 finalize/cancel 状态迁移。
- 关键写操作使用 Lua/事务保证原子性：
  - 校验当前状态 + 写答案 + 状态迁移 + 发布唤醒事件。

## 11. 配置系统设计

### 11.1 四级优先级（高 -> 低）
1. 环境变量（`process.env`）
2. `.env` 文件
3. YAML 配置文件（如 `config/hitl-mcp.yaml`）
4. 默认配置

### 11.2 配置项（示例）
- `server.name`, `server.version`, `server.base_url`
- `mcp.transport` (`stdio|http`)
- `http.host`, `http.port`, `http.api_prefix`
- `redis.url`, `redis.prefix`, `redis.connect_timeout_ms`
- `ttl.default_seconds`, `ttl.answered_retention_seconds`
- `pending.max_wait_seconds`（0 表示无限等待）
- `security.api_key`, `security.auth_mode`
- `observability.log_level`, `observability.enable_metrics`

### 11.3 合并规则
- 标量：高优先级覆盖低优先级。
- 对象：深度合并（冲突字段按优先级覆盖）。
- 数组：默认整体覆盖（避免隐式拼接导致不可预测行为）。

## 12. 稳定性与可扩展性设计

### 12.1 稳定性
- 阻塞等待采用可恢复机制（进程重启后根据 Redis 重建 waiter）。
- finalize 全链路幂等。
- 超时、取消、过期均有明确终态。

### 12.2 可扩展性
- 无状态服务实例 + Redis 共享状态，支持水平扩缩容。
- 问题类型可扩展：新增类型通过 schema discriminator 扩展，不破坏旧协议。
- 可插拔校验器：按 question type 注册 validator。

### 12.3 可观测性
- 结构化日志字段：`group_id`, `question_id`, `status_from`, `status_to`, `request_id`。
- 指标：
  - `hitl_pending_count`
  - `hitl_finalize_success_total`
  - `hitl_finalize_validation_failed_total`
  - `hitl_wait_duration_ms`
- 可选 tracing：MCP tool 调用与 HTTP finalize 使用同一 trace_id 串联。

## 13. 安全设计
- HTTP API 支持 `Api-Key`（MVP）与 JWT/OAuth（后续）。
- 输入严格 Zod 校验，禁止未定义字段写入核心实体。
- `extra` 虽为 schema-free object，但需限制大小（如 16KB）与深度。
- 基于 IP/API key 的速率限制（Hono middleware）。

## 14. 测试策略（文档级）
- 单元测试：
  - 各题型 validator
  - 状态机迁移
  - 配置加载优先级
- 集成测试：
  - `ask -> pending -> finalize(valid) -> answered`
  - `ask -> finalize(invalid) -> pending`
  - 幂等提交与并发 finalize
- 故障测试：
  - Redis 短暂不可用
  - MCP 连接中断恢复
  - TTL 过期后行为

## 15. 里程碑建议
1. M1：核心模型 + Redis 持久化 + `hitl_ask_question_group` 阻塞等待。
2. M2：HTTP finalize 与校验错误模型。
3. M3：查询/取消 API + 观测性 + 幂等强化。
4. M4：压测、故障注入、生产参数调优。

## 16. 开放问题（待你确认）
- 是否要求 `question_group_id` 由调用方强制传入，还是允许服务端生成后回传？（当前设计：调用方传入，保证外部状态对齐）
- `pending.max_wait_seconds` 默认值是否使用无限等待（0）？（当前设计：默认无限）
- `PATCH /answers`（部分答案草稿）是否在首版启用？（当前设计：保留接口，可先不开放）

## 17. 结论
本设计选择“阻塞式 MCP 提问 + HTTP 最终提交”的双平面架构，满足以下关键目标：
- 结构化问题可被客户端稳定渲染；
- Agent 会话在未收最终答案前保持 pending；
- 提供生产级可运维的 HTTP 管控面；
- 使用 Redis 实现跨 session 持久化、幂等与扩展能力。
