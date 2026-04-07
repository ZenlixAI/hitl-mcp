# hitl-mcp

一个面向 Agentic 系统的人类在环（Human-in-the-loop）MCP Server。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-green.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | [中文](README-zh.md)

---

## 目录

- [项目背景](#项目背景)
- [项目目标](#项目目标)
- [用户视角](#用户视角)
- [端到端流程](#端到端流程)
- [关键设计决策](#关键设计决策)
- [当前能力](#当前能力)
- [快速开始](#快速开始)
- [配置项](#配置项)
- [使用示例](#使用示例)
- [MCP 工具说明](#mcp-工具说明)
- [HTTP API 说明](#http-api-说明)
- [项目结构](#项目结构)
- [文档导航](#文档导航)
- [开发与测试](#开发与测试)
- [运维与部署](#运维与部署)
- [项目状态](#项目状态)
- [许可证](#许可证)
- [版权](#版权)

---

## 项目背景

在复杂 Agent 工作流中，直接用 assistant 文本提问存在天然问题：

1. 缺少结构化输出，前端难以稳定渲染问题卡片。
2. 缺少稳定的问题组与问题生命周期跟踪。
3. 不利于“用户回答 -> 服务端后处理 -> 最终确认”的工程链路。

传统的阻塞式单工具 HITL 方案对 Agent 平台也不够友好：

1. Agent 自己持有本应由服务端拥有的标识符。
2. 重连、重试、多 Session 下的作用域不清晰。
3. client 难以在用户真正回答前稳定感知 `pending` 问题组。

`hitl-mcp` 用服务端拥有的身份和生命周期模型解决这些问题：

1. `agent_identity` 由 MCP 连接认证推导。
2. `agent_session_id` 由稳定的连接级 header 推导，默认 `x-agent-session-id`。
3. `question_group_id` 永远由服务端生成。
4. 对同一个 `(agent_identity, agent_session_id)`，同时最多只有一个 `pending` 问题组。

## 项目目标

- 永远以 **Question Group** 发问，不支持裸问题。
- 让问题组主键和生命周期归服务端所有。
- 让 Agent 平台在用户最终回答前就能观察到 `pending` 问题组。
- 支持题型：
  - `single_choice`
  - `multi_choice`
  - `text`
  - `boolean`
  - `range`
- 支持必答（默认）与可选。
- group/question 均支持 `tags` 与 `extra`。
- HTTP API 采用“按 ID 操作”模型。
- 使用 KV（Redis）做持久化与 TTL。

## 用户视角

### 开发者（Agent 开发）

通过 MCP 工具完成创建、等待与查询：

- `hitl_create_question_group`
- `hitl_wait_question_group`
- `hitl_get_current_question_group`
- `hitl_get_question_group_status`
- `hitl_get_question`
- `hitl_cancel_question_group`

你的 Agent 不需要自己生成问题组 ID，也不需要发明额外的 pending 协议。

### 开发者（后端服务）

通过 HTTP 控制面提交最终答案与管理状态：

- `PUT /api/v1/question-groups/{id}/answers/finalize`
- `POST /api/v1/question-groups/{id}/cancel`
- `POST /api/v1/question-groups/{id}/expire`
- `GET /api/v1/question-groups/current`
- `GET /api/v1/question-groups/{id}`
- `GET /api/v1/questions/{id}`

不提供 list API（设计使然）。

## 端到端流程

1. Agent 调用 `hitl_create_question_group` 发出结构化问题组。
2. 服务端认证调用方，读取 `x-agent-session-id`，生成 `question_group_id`，并落为 `pending`。
3. client 或后端立即拿到返回的 `question_group_id`，可以感知和展示 pending 状态。
4. 当需要阻塞等待时，Agent 调用 `hitl_wait_question_group`。
5. 用户在客户端完成回答。
6. 你的后端对回答做业务后处理。
7. 后端调用 `answers/finalize` 提交最终答案。
8. `hitl-mcp` 校验：
   - 不合法：返回 `422 ANSWER_VALIDATION_FAILED`，状态保持 `pending`
   - 合法：状态切为 `answered`，唤醒阻塞的 MCP wait 调用
9. Agent 拿到最终答案并继续执行。

## 关键设计决策

### 1) 服务端生成 Question Group ID

`question_group_id` 不允许由 Agent 提供，确保对象主键和生命周期权限归服务端所有。

### 2) 稳定的调用方作用域

调用方作用域由可信的连接上下文决定：

- `agent_identity` 来自连接认证
- `agent_session_id` 来自稳定的连接级 header

不再依赖 tool input 中的 session metadata。

### 3) 拆分 Create 与 Wait

MCP 工具面被明确拆成：

- `create`：创建 `pending` 问题组并立即返回
- `wait`：仅在 Agent 需要阻塞语义时才等待
- `get_current`：用于按调用方作用域恢复当前 pending 状态

### 4) 每个调用方作用域只允许一个 Pending

对同一个 `(agent_identity, agent_session_id)`，同时最多存在一个 `pending` 问题组。

这让 client 侧 pending 状态保持确定性。

### 5) 校验与幂等

finalize 支持类型/范围校验与必答校验；可选题若不回答，必须显式放入 `skipped_question_ids`。create/finalize 都可通过 `idempotency_key` 实现幂等。

### 6) 存储策略

- 内存仓储：本地开发。
- Redis 仓储：持久化与 TTL。
- 为调用方作用域查找和 create 幂等维护额外索引。

## 当前能力

- 问题与答案 schema、校验器。
- MCP 工具：create/wait/current/status/get/cancel。
- HTTP API：health、ready、metrics、query、current、finalize、cancel、expire。
- 状态机：`pending -> answered|cancelled|expired`。
- 显式等待与唤醒机制。
- HTTP API key 鉴权（开启后要求 `x-api-key`）。
- 已认证调用方身份与 session header 的 request context 提取。
- Redis 仓储实现与测试。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务

```bash
npm run dev
```

默认端口：`3000`

### 健康检查

```bash
npx hono request hono.request.ts -P /api/v1/healthz
```

### 运行测试

```bash
npm run test
```

## 配置项

环境变量：

- `PORT`：服务端口（默认 `3000`）
- `MCP_URL`：MCP 基础地址（默认 `http://localhost:3000`）
- `HITL_PENDING_MAX_WAIT_SECONDS`：阻塞等待秒数，`0` 为无限等待
- `HITL_STORAGE`：`memory` 或 `redis`
- `HITL_REDIS_URL`：Redis 地址（默认 `redis://127.0.0.1:6379`）
- `HITL_REDIS_PREFIX`：Redis key 前缀（默认 `hitl`）
- `HITL_TTL_SECONDS`：TTL（默认 `604800`）
- `HITL_API_KEY`：开启后受保护 HTTP 路由需要 `x-api-key`
- `HITL_AGENT_AUTH_MODE`：`api_key` 或 `bearer`
- `HITL_AGENT_SESSION_HEADER`：默认 `x-agent-session-id`
- `HITL_CREATE_CONFLICT_POLICY`：`error` 或 `reuse_pending`
- `HITL_SERVER_NAME`：可选，Server 名称覆盖
- `HITL_SERVER_VERSION`：可选，Server 版本覆盖
- `HITL_HTTP_HOST`：可选，HTTP 绑定地址
- `HITL_HTTP_API_PREFIX`：可选，默认 `/api/v1`
- `HITL_ANSWERED_RETENTION_SECONDS`：可选
- `HITL_LOG_LEVEL`：`debug|info|warn|error`
- `HITL_ENABLE_METRICS`：`true|false`

优先级：

- `env` > `.env` > `config/hitl-mcp.yaml` > defaults

## 使用示例

### Agent 调用 MCP 创建问题组

工具：`hitl_create_question_group`

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

### Agent 等待当前 Pending 问题组

工具：`hitl_wait_question_group`

```json
{}
```

### 服务端 finalize

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

## MCP 工具说明

### `hitl_create_question_group`

用途：

- 为当前认证调用方作用域创建一个 `pending` 问题组，并立即返回。

输入（关键字段）：

- `title`（string，必填）
- `description`（string，可选，支持 markdown）
- `tags`（string[]，可选）
- `extra`（object，可选）
- `ttl_seconds`（number，可选）
- `questions`（array，必填）
- `idempotency_key`（string，可选）

调用方作用域：

- `agent_identity` 由认证推导
- `agent_session_id` 由配置的 session header 推导

输出：

- 服务端生成的 `question_group_id`
- `status: "pending"`
- 调用方作用域字段
- 时间戳与问题组载荷

### `hitl_wait_question_group`

用途：

- 等待问题组进入终态（`answered`、`cancelled`、`expired`）。

输入：

- `question_group_id`（string，可选）

行为：

- 传 `question_group_id` 时，等待指定问题组。
- 不传时，等待当前调用方作用域下唯一的 pending 问题组。

输出：

- finalize 成功：`status=answered` + 校验后的 `answers`
- 取消：`status=cancelled`
- 过期：`status=expired`

说明：

- 该工具是阻塞式设计。
- 当 `HITL_PENDING_MAX_WAIT_SECONDS=0` 时，为无限等待。

### `hitl_get_current_question_group`

用途：

- 返回当前调用方作用域下的 pending 问题组。

输出：

- 存在时返回完整 pending 问题组对象。
- 不存在时返回 `PENDING_GROUP_NOT_FOUND`。

### `hitl_get_question_group_status`

用途：

- 按 ID 查询问题组生命周期状态。

输入：

- `question_group_id`（string）

输出：

- `question_group_id`
- `status`（`pending|answered|cancelled|expired`）
- `updated_at`

### `hitl_get_question`

用途：

- 按 `question_id` 查询题目定义。

输入：

- `question_id`（string）

输出：

- 题目完整对象。

### `hitl_cancel_question_group`

用途：

- 取消 pending 问题组，并唤醒阻塞中的 wait 调用。

输入：

- `question_group_id`（string）
- `reason`（string，可选）

输出：

- `status: "cancelled"`
- 可选 `reason`

## HTTP API 说明

基础路径：

- `/api/v1`

统一响应包裹：

```json
{
  "request_id": "uuid",
  "success": true,
  "data": {},
  "error": null
}
```

### `GET /healthz`

用途：

- 健康检查。

成功：

- `200`，且 `data.status = "ok"`。

### `GET /readyz`

用途：

- 部署系统 readiness 探针。

行为：

- 存储可用时返回 `200` 且 `status=ready`。
- 存储不可用时返回 `503` 且 `status=not_ready`。

### `GET /metrics`

用途：

- 运维指标端点。

响应包含：

- `counters.finalize_validation_failed_total`
- `counters.finalize_success_total`
- `gauges.pending_count`
- `histograms.wait_duration_ms`（count/min/max/avg）

### `GET /question-groups/current`

用途：

- 按已认证调用方作用域查询当前 pending 问题组。

请求头：

- 开启 API key 时需要 `x-api-key`
- 配置的 session header，默认 `x-agent-session-id`

错误：

- `401 UNAUTHORIZED`
- `400 AGENT_SESSION_ID_REQUIRED`
- `404 PENDING_GROUP_NOT_FOUND`

### `GET /question-groups/{question_group_id}`

用途：

- 按 `question_group_id` 查询问题组。

错误：

- `404 QUESTION_GROUP_NOT_FOUND`

### `GET /questions/{question_id}`

用途：

- 按 `question_id` 查询题目。

错误：

- `404 QUESTION_NOT_FOUND`

### `PUT /question-groups/{question_group_id}/answers/finalize`

用途：

- 提交经过后端处理的最终答案。

请求体：

```json
{
  "idempotency_key": "idem-1",
  "answers": {
    "q_1": { "value": "A" }
  },
  "skipped_question_ids": ["q_optional_1"],
  "finalized_by": "agent-server",
  "extra": {}
}
```

行为：

- 进行类型/范围/必答校验。
- 可选题必须“回答或显式忽略（`skipped_question_ids`）”。
- 若不合法：保持 `pending`。
- 若合法：切换到 `answered` 并唤醒阻塞的 MCP wait 调用。

成功：

- `200`，包含 `status: "answered"`、`answered_question_ids` 与 `skipped_question_ids`。

校验失败：

- `422 ANSWER_VALIDATION_FAILED`，并返回逐题错误详情。

幂等：

- 复用相同 `idempotency_key` 应返回同一 finalize 结果。

### `POST /question-groups/{question_group_id}/cancel`

用途：

- 取消 pending 问题组。

行为：

- 状态置为 `cancelled`。
- 唤醒阻塞中的 MCP wait 调用（终态返回）。

### `POST /question-groups/{question_group_id}/expire`

用途：

- 强制使问题组过期。

行为：

- 状态置为 `expired`。
- 唤醒阻塞中的 MCP wait 调用（终态返回）。

### 鉴权

当设置 `HITL_API_KEY` 时：

- 受保护路由需要 `x-api-key` 请求头。
- 缺失或错误返回 `401 UNAUTHORIZED`。

### 常见错误码

- `QUESTION_GROUP_NOT_FOUND`（`404`）
- `QUESTION_NOT_FOUND`（`404`）
- `PENDING_GROUP_NOT_FOUND`（`404`）
- `AGENT_IDENTITY_REQUIRED`（`401`）
- `AGENT_SESSION_ID_REQUIRED`（`400`）
- `ANSWER_VALIDATION_FAILED`（`422`）
- `UNAUTHORIZED`（`401`）

## 项目结构

```text
hitl-mcp/
├── index.ts
├── src/
├── config/
├── tests/
├── docs/
├── public/
├── README.md
├── README-zh.md
└── package.json
```

## 文档导航

- MCP 工具契约：[docs/api/mcp-tools.md](docs/api/mcp-tools.md)
- HTTP API 契约：[docs/api/http-openapi.md](docs/api/http-openapi.md)
- 产品技术设计：[docs/design-doc.md](docs/design-doc.md)
- 重构实施计划：[docs/superpowers/plans/2026-04-02-hitl-agent-identity-session-refactor.md](docs/superpowers/plans/2026-04-02-hitl-agent-identity-session-refactor.md)
- 生产运维手册：[docs/runbooks/production.md](docs/runbooks/production.md)

## 开发与测试

当前测试覆盖了单元与集成场景，包括作用域 pending 行为、pending->answered 闭环与幂等。

## 运维与部署

Docker 相关文件：

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`（包含 Redis + app service）

## 运维与部署

Docker 相关文件：

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`（包含 Redis + app service）

## 项目状态

当前仓库已具备基于新 identity/session 作用域模型的 HITL 主链路和主要集成面。面向大规模生产部署时，仍可继续增强（例如更完整的认证方式、指标导出与运维手册）。

## 许可证

MIT，见 [LICENSE](LICENSE)。

## 版权

Copyright (c) 2026 ZenlixAI. All rights reserved.
