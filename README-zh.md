# hitl-mcp

一个面向 Agentic 系统的人类在环（Human-in-the-loop）MCP Server。

`hitl-mcp` 让 AI Agent 能够稳定地发起结构化提问、挂起等待，并且只在服务端通过 HTTP 完成“最终答案提交”后继续执行。

## 项目背景

在复杂 Agent 工作流中，直接用 assistant 文本提问存在天然问题：
- 缺少结构化输出，前端难以稳定渲染问题卡片。
- 缺少稳定 `question_group_id` / `question_id`，状态难维护。
- 不利于“用户回答 -> 服务端后处理 -> 最终确认”的工程链路。

同时，CLI/TUI 优先的方案对 Web 集成不够友好：
- UI 与 MCP 服务耦合；
- 缺少清晰的 HTTP 管控面；
- 难以做全局持久化与跨会话恢复。

`hitl-mcp` 的目标是提供协议清晰、后端可控、可持久化的 HITL 基础设施。

## 项目目标

- 永远以 **Question Group** 发问，不支持裸问题。
- MCP 调用在 finalize 前保持 **pending**。
- 支持题型：
  - `single_choice`
  - `multi_choice`
  - `text`
  - `boolean`
  - `range`
- 支持必答（默认）与可选。
- group/question 均支持 `tags` 与 `extra`。
- HTTP API 采用“按 ID 操作”模型，不提供 list。
- 使用 KV（Redis）做持久化与 TTL。

## 用户视角

### 开发者（Agent 开发）
通过 MCP 工具完成提问与等待：
- `hitl_ask_question_group`
- `hitl_get_question_group_status`
- `hitl_get_question`
- `hitl_cancel_question_group`

你的 Agent 不需要自己实现等待队列或轮询协议。

### 开发者（后端服务）
通过 HTTP 控制面提交最终答案与管理状态：
- `PUT /api/v1/question-groups/{id}/answers/finalize`
- `POST /api/v1/question-groups/{id}/cancel`
- `POST /api/v1/question-groups/{id}/expire`
- `GET /api/v1/question-groups/{id}`
- `GET /api/v1/questions/{id}`

## User Story（端到端）

1. Agent 调用 `hitl_ask_question_group` 发出结构化问题组。
2. `hitl-mcp` 落库并置为 `pending`，该 MCP 调用挂起。
3. 客户端基于 question IDs 渲染 UI。
4. 用户在客户端完成回答。
5. 你的后端对回答做业务后处理。
6. 后端调用 `answers/finalize` 提交最终答案。
7. `hitl-mcp` 校验：
   - 不合法：返回 `422`，状态保持 `pending`
   - 合法：状态切为 `answered`，唤醒阻塞 MCP 调用
8. Agent 拿到最终答案并继续执行。

## 关键设计决策

### 1) 阻塞式 Ask Tool
`hitl_ask_question_group` 采用阻塞等待，确保“没有 finalize 就不继续”。

### 2) Question Group First
统一以问题组管理生命周期，便于前端状态同步和后端治理。

### 3) 无 List 的 HTTP 管控面
所有读写必须带 `question_group_id` 或 `question_id`，减少歧义与误用。

### 4) MCP 面 + HTTP 面职责分离
- MCP 面：模型交互语义（提问/等待）
- HTTP 面：服务端控制语义（确认/取消/过期）

### 5) 校验与幂等
finalize 支持类型/范围校验与必答校验；支持 `idempotency_key`。

### 6) 存储策略
- 内存仓储：本地开发。
- Redis 仓储：持久化与 TTL。
- Redis 不可用时可自动回退内存仓储（可配置场景）。

## 当前已实现能力

- 问题与答案 schema、校验器。
- MCP 工具：ask/status/get/cancel。
- HTTP API：health、query、finalize、cancel、expire。
- 状态机：`pending -> answered|cancelled|expired`。
- 阻塞等待与唤醒机制。
- HTTP API key 鉴权（开启后要求 `x-api-key`）。
- Redis 仓储实现与测试。

## 快速开始

```bash
npm install
npm run dev
```

默认端口：`3000`

健康检查（Hono CLI）：

```bash
npx hono request hono.request.ts -P /api/v1/healthz
```

## 配置项

- `PORT`：服务端口（默认 `3000`）
- `MCP_URL`：MCP 基础地址（默认 `http://localhost:3000`）
- `HITL_PENDING_MAX_WAIT_SECONDS`：阻塞等待秒数，`0` 为无限等待
- `HITL_STORAGE`：`memory` 或 `redis`
- `HITL_REDIS_URL`：Redis 地址（默认 `redis://127.0.0.1:6379`）
- `HITL_REDIS_PREFIX`：Redis key 前缀（默认 `hitl`）
- `HITL_TTL_SECONDS`：TTL（默认 `604800`）
- `HITL_API_KEY`：开启后 HTTP 受保护路由需要 `x-api-key`

## 使用示例

### Agent 调用 MCP 提问

工具：`hitl_ask_question_group`

```json
{
  "question_group_id": "qg_release_001",
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

### 服务端 finalize

```bash
curl -X PUT "http://localhost:3000/api/v1/question-groups/qg_release_001/answers/finalize" \
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

## 文档导航

- MCP 工具契约：[docs/api/mcp-tools.md](docs/api/mcp-tools.md)
- HTTP API 契约：[docs/api/http-openapi.md](docs/api/http-openapi.md)
- 产品技术设计：[docs/design-doc.md](docs/design-doc.md)

## 开发与测试

```bash
npm run test
```

当前测试覆盖了单元与集成场景，包括 pending->answered 闭环与 finalize 幂等。

## 项目状态

当前仓库已具备 HITL 主链路和主要集成面。面向大规模生产部署时，仍可继续增强（例如更完整的认证方式、指标导出与运维手册）。
