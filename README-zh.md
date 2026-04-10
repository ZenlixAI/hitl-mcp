# hitl-mcp

面向 Agent 工作流的 question-only HITL MCP 服务。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-green.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | [中文](README-zh.md)

---

## 目录

- [背景](#背景)
- [什么是 hitl-mcp](#什么是-hitl-mcp)
- [设计目标](#设计目标)
- [非目标](#非目标)
- [核心模型](#核心模型)
- [快速开始](#快速开始)
- [交互如何工作](#交互如何工作)
- [MCP 工具](#mcp-工具)
- [HTTP API](#http-api)
- [运行时配置](#运行时配置)
- [内部工作原理](#内部工作原理)
- [架构](#架构)
- [运维](#运维)
- [项目结构](#项目结构)

---

## 背景

在很多 Agent 系统里，Agent 运行到某个阶段后无法继续完全自动执行：

- 需要人工批准或驳回某个决策
- 需要人工在多个候选项中做选择
- 需要人工补充业务输入
- 需要工作流暂停，直到人工确认返回

如果没有专门的 HITL 层，这类流程通常会落到零散 prompt、旁路 UI 或自定义回调协议上，最终会出现三个典型问题：

1. Agent 与业务系统之间没有统一的“待人工处理”模型。
2. 人工回答难以和具体的 Agent 运行实例、会话上下文正确关联。
3. wait、部分提交、取消、恢复等语义在不同客户端之间无法保持一致。

`hitl-mcp` 的目标就是把这件事收敛成一个很窄但清晰的契约：

- Agent 发起问题
- 客户端或运营界面读取待处理问题
- 人类回答、跳过或取消这些问题
- Agent 通过 caller scope 级别的状态机等待流程完成

---

## 什么是 hitl-mcp

`hitl-mcp` 是一个同时提供 **MCP** 与 **HTTP** 两种接入面的人工介入服务。

它通过同一份底层状态，对外提供两类能力：

- **MCP tools**：给 Agent 和 Agent 平台直接调用
- **HTTP APIs**：给运营后台、业务后端或自定义审批界面调用

这个服务对外暴露的抽象非常克制：

- 对外公共单元只有 `question`
- question 总是属于某个 **caller scope**
- answer 可以分批提交
- wait 是 scope 级别的操作，不是 question 级别的长轮询

它适用于“Agent 发起、人工补全决策回路”的工作流。

---

## 设计目标

- 为 Agent 工作流提供稳定、最小化的 HITL 协议面。
- 用 `agent_identity` 和 `agent_session_id` 明确 caller 隔离边界。
- 支持同一个 caller scope 中同时存在多个 pending questions。
- 支持增量提交，而不是强制一次性交付全部答案。
- 让 MCP 客户端和 HTTP 客户端共享同一份 question 状态。
- 让本地开发可以使用 memory，生产环境可以切换到 Redis。
- 通过 health、readiness、metrics 和结构化日志提升可运维性。

---

## 非目标

- 不是通用工作流引擎。
- 不是审批 UI 框架。
- 不是任务队列或事件总线。
- 不是通用表单搭建系统。
- 不是权限策略系统，也不负责任务分派。
- 不是面向任意业务流程的完整编排平台。

`hitl-mcp` 只负责 question 状态、caller scope、wait 语义和 answer 提交。

---

## 核心模型

### 对外公共单元：question

系统对外只暴露 `question`。

一个 question 包含：

- 服务端生成的 `question_id`
- `type`
- `title`、`description`、`tags`、`extra` 等提示元数据
- `pending`、`answered`、`skipped`、`cancelled` 等状态

当前支持的问题类型：

- `single_choice`
- `multi_choice`
- `text`
- `boolean`
- `range`

### Caller scope

每个操作都绑定到下面这组 caller scope：

- `agent_identity`
- `agent_session_id`

这个 scope 是以下行为的隔离边界：

- 创建问题
- 获取待处理问题
- 等待进度变化
- 提交答案
- 取消问题

只要 caller scope 不同，两个 Agent 即使创建出内容完全相同的问题，也不会互相冲突。

### 内部分组与公共 API 的关系

存储层内部仍然可以保留 group 结构，但那只是实现细节。

公共 API 被刻意设计成 question-first：

- 创建 questions
- 读取 pending questions
- 按 `question_id` 提交 answers
- 按 `question_id` 取消问题
- 对 scope 执行 wait

### 部分提交

答案不要求一次性全部提交。

服务端接受增量进度：

- 先回答一个问题
- 稍后再回答另一个问题
- 显式跳过可选问题
- 持续 wait，直到当前 scope 完成

### Wait 模式

`hitl_wait` 以及等价的 scope 级等待行为支持两种模式：

- `terminal_only`：只有当 scope 下没有 pending questions 时才返回
- `progressive`：每次状态变化都返回一次，调用方可以继续 wait

`terminal_only` 适合线性流程。`progressive` 适合调用方需要对中间进度做实时响应的场景。

---

## 快速开始

## 安装

```bash
git clone <your-repo-url>
cd hitl-mcp
npm install
```

## 本地开发运行

```bash
npm run dev
```

默认本地监听：

- HTTP base URL: `http://0.0.0.0:4000`
- MCP base URL: `http://0.0.0.0:4000/mcp`
- HTTP API prefix: `/api/v1`

## 使用 Docker 运行

构建镜像：

```bash
docker build -t hitl-mcp .
```

使用内存存储运行：

```bash
docker run --rm -p 4000:4000 \
  -e MCP_URL=http://localhost:4000 \
  hitl-mcp
```

使用 Redis 运行：

```bash
docker run --rm -p 4000:4000 \
  -e MCP_URL=http://localhost:4000 \
  -e HITL_STORAGE=redis \
  -e HITL_REDIS_URL=redis://host.docker.internal:6379 \
  hitl-mcp
```

## 从源码配环境变量运行

```bash
export MCP_URL=http://localhost:4000
npm run dev
```

## 最小创建示例

```bash
curl -X POST "http://localhost:4000/api/v1/questions" \
  -H "Content-Type: application/json" \
  -H "x-agent-identity: agent/example" \
  -H "x-agent-session-id: session-123" \
  -d '{
    "title": "Release decision",
    "questions": [
      {
        "type": "single_choice",
        "title": "Deploy to production?",
        "options": [
          { "value": "yes", "label": "Yes" },
          { "value": "no", "label": "No" }
        ]
      }
    ]
  }'
```

---

## 交互如何工作

这一节描述的是推荐运行时流程，不区分调用方最终走的是 MCP 还是 HTTP。

### 时序 1：标准 ask -> wait -> answer -> complete

1. Agent 在自己的 caller scope 下创建一个或多个问题。
2. UI 或后端读取这个 scope 下的 pending questions。
3. 人类回答其中一个或多个问题。
4. Agent 对该 scope 执行 wait。
5. 当 scope 下不再有 pending questions 时，wait 返回 terminal 结果。

### 时序 2：部分提交

1. Agent 一次创建多个问题。
2. 人类只回答其中一部分。
3. 服务端保存已提交的答案，未回答的问题继续保持 pending。
4. Agent 可以继续 wait。
5. 后续提交持续累积，直到整个 scope 完成。

### 时序 3：progressive wait

1. 设置 `HITL_WAIT_MODE=progressive`
2. Agent 调用 `hitl_wait`
3. 任何 answer、skip 或 cancel 都会唤醒等待中的调用
4. wait 结果会带回本次变化的 `question_id`
5. Agent 决定是继续 wait，还是先处理这次中间结果

### 时序 4：取消

1. 调用方取消一个问题，或取消当前 scope 下所有 pending questions。
2. 服务端更新 scope 状态并通知 waiter。
3. 如果 scope 下不再有 pending questions，则该 scope 进入 terminal 状态。

### 为什么 wait 是 scope 级别

wait 始终是 **scope 级操作**，这是有意为之：

- 一个 Agent 运行实例可能同时挂起多个问题
- Agent 真正关心的通常是“当前流程能否继续”
- 以 scope 为单位等待，可以避免大量碎片化的逐 question 同步逻辑

---

## MCP 工具

`hitl-mcp` 当前暴露以下 MCP tools：

### `hitl_ask`

在当前 caller scope 下创建一个或多个问题。

输入示例：

```json
{
  "title": "Release decision",
  "description": "Human approval required before deploy",
  "ttl_seconds": 3600,
  "questions": [
    {
      "type": "boolean",
      "title": "Approve deployment?"
    }
  ]
}
```

注意：

- 调用方不能传 `question_id`
- `question_id` 由服务端生成
- 一次请求可以创建多个问题

### `hitl_wait`

对当前 caller scope 执行等待。

典型返回字段：

- `status`
- `is_terminal`
- `changed_question_ids`
- `pending_questions`
- `answered_question_ids`
- `skipped_question_ids`
- `cancelled_question_ids`
- `is_complete`

### `hitl_get_pending_questions`

返回当前 caller scope 下全部 pending questions。

### `hitl_submit_answers`

提交新答案，以及可选的 skipped questions。

输入示例：

```json
{
  "answers": {
    "q_01JXYZ...": { "value": true }
  },
  "skipped_question_ids": ["q_01JABC..."],
  "idempotency_key": "idem-1"
}
```

注意：

- `answers` 可以只覆盖部分 pending questions
- 可选问题可以显式 skip
- 必答题不能 skip
- 多次提交会在服务端累积保存

### `hitl_cancel_questions`

取消指定 pending questions，或取消整个 scope 下所有 pending questions。

输入示例：

```json
{
  "question_ids": ["q_01JXYZ..."],
  "reason": "no longer needed"
}
```

或者：

```json
{
  "cancel_all": true
}
```

### `hitl_get_question`

根据 `question_id` 获取单个问题。

---

## HTTP API

HTTP 控制面主要面向运营界面、业务后端和排障工具。

### 响应信封

所有 HTTP 响应都使用统一信封：

```json
{
  "request_id": "http-request-id",
  "success": true,
  "data": {},
  "error": null
}
```

失败时：

```json
{
  "request_id": "http-request-id",
  "success": false,
  "data": {},
  "error": {
    "code": "QUESTION_NOT_FOUND",
    "message": "question not found",
    "details": null
  }
}
```

### Header 与身份规则

对于 question 相关 HTTP API，所有 caller-scoped 请求都需要 session header：

- 默认 session header：`x-agent-session-id`

身份规则：

- 所有 caller-scoped 请求都发送 `x-agent-identity`

行为上：

- 服务端直接从 `x-agent-identity` 读取 `agent_identity`

### `GET /api/v1/healthz`

返回存活状态。

### `GET /api/v1/readyz`

返回就绪状态。

对于 Redis 支撑的生产部署，应使用它作为真正的流量探针。

### `GET /api/v1/metrics`

返回进程内 metrics 快照。

### `POST /api/v1/questions`

在当前 caller scope 下创建一个或多个问题。

请求体：

```json
{
  "title": "Release decision",
  "description": "Human approval required before deploy",
  "ttl_seconds": 3600,
  "questions": [
    {
      "type": "single_choice",
      "title": "Deploy to production?",
      "options": [
        { "value": "yes", "label": "Yes" },
        { "value": "no", "label": "No" }
      ]
    },
    {
      "type": "text",
      "title": "Anything to note?",
      "required": false
    }
  ]
}
```

支持的问题体：

- `single_choice`，带 `options`
- `multi_choice`，带 `options`
- `text`，可选 `text_constraints`
- `boolean`
- `range`，带 `range_constraints`

### `GET /api/v1/questions/pending`

返回当前 caller scope 下全部 pending questions。

### `POST /api/v1/questions/answers`

提交 answered questions 和 skipped questions。

请求体：

```json
{
  "answers": {
    "q_01JXYZ...": { "value": "yes" }
  },
  "skipped_question_ids": ["q_01JABC..."],
  "idempotency_key": "idem-1"
}
```

行为：

- 支持部分提交
- 服务端累积保存 scope 状态
- 成功提交后会唤醒该 scope 的 waiter

典型错误码：

- `QUESTION_NOT_FOUND`
- `ANSWER_VALIDATION_FAILED`

### `POST /api/v1/questions/cancel`

取消当前 caller scope 中的 pending questions。

请求体：

```json
{
  "question_ids": ["q_01JXYZ..."],
  "reason": "no longer needed"
}
```

或者：

```json
{
  "cancel_all": true
}
```

### `GET /api/v1/questions/:question_id`

根据 `question_id` 获取单个问题。

如果问题不存在，返回 `404`，错误码为 `QUESTION_NOT_FOUND`。

---

## 运行时配置

## 配置来源与优先级

配置按以下顺序加载：

1. 内建默认值
2. `config/hitl-mcp.yaml`
3. `.env`
4. 进程环境变量

后者覆盖前者。

## 环境变量

下面这些环境变量是当前代码中已经支持的完整集合。

| 变量 | 默认值 | 作用 | 何时需要修改 |
| --- | --- | --- | --- |
| `PORT` | `4000` | 兜底 HTTP 端口。设置后效果等价于 `HITL_HTTP_PORT`。 | 当运行平台只注入 `PORT`，或平台要求固定端口变量时。 |
| `MCP_URL` | `http://0.0.0.0:4000` | MCP server metadata 中对外暴露的 base URL。 | 任何非本地部署都应改成外部可达地址。 |
| `HITL_SERVER_NAME` | `hitl-mcp` | MCP server 名称元数据。 | 当你要把它嵌入到自己的产品命名体系时。 |
| `HITL_SERVER_VERSION` | `0.1.0` | MCP server 版本元数据。 | 当你要发布一个明确版本的运行实例时。 |
| `HITL_HTTP_HOST` | `0.0.0.0` | HTTP 监听地址。 | 仅当你想限制为 loopback 或绑定其他网卡时。 |
| `HITL_HTTP_PORT` | `4000` | 显式 HTTP 端口。覆盖默认端口。 | 本地多服务并行或生产自定义端口映射时。 |
| `HITL_HTTP_API_PREFIX` | `/api/v1` | HTTP 控制面路由前缀。 | 只有在你要把 API 挂载到不同路径下时才需要改。 |
| `HITL_STORAGE` | `memory` | 存储后端选择：`memory` 或 `redis`。 | 生产和多进程部署应设置为 `redis`。 |
| `HITL_REDIS_URL` | `redis://127.0.0.1:6379` | Redis 连接地址。 | 当 `HITL_STORAGE=redis` 且本地默认地址不适用时。 |
| `HITL_REDIS_PREFIX` | `hitl` | Redis key 前缀。 | 多个环境共用一个 Redis 时应区分前缀。 |
| `HITL_TTL_SECONDS` | `604800` | 新创建问题集的默认 TTL。 | 当待人工处理的保留期限需要和业务 SLA 对齐时。 |
| `HITL_ANSWERED_RETENTION_SECONDS` | `2592000` | 已回答状态的保留时长。 | 当审计需求或存储压力要求不同保留策略时。 |
| `HITL_PENDING_MAX_WAIT_SECONDS` | `0` | 单次 wait 的最大时长。`0` 表示不限制。 | 当你需要控制 worker 占用时长或请求生命周期上限时。 |
| `HITL_WAIT_MODE` | `terminal_only` | scope wait 行为：`terminal_only` 或 `progressive`。 | 当调用方需要感知每一次中间变化时设置为 `progressive`。 |
| `HITL_AGENT_SESSION_HEADER` | `x-agent-session-id` | 读取 `agent_session_id` 的 header 名称。 | 当你接入现有网关或客户端，需要复用其他 session header 时。 |
| `HITL_CREATE_CONFLICT_POLICY` | `error` | 配置面中的创建冲突策略。 | 建议保持默认。当前代码会加载并校验，但 handler 尚未实际使用。 |
| `HITL_LOG_LEVEL` | `info` | 结构化日志级别：`debug`、`info`、`warn`、`error`。 | 需要排障时提高，生产环境需要降噪时调低。 |
| `HITL_ENABLE_METRICS` | `true` | 是否在配置中启用 metrics。 | 除非你明确想减少可观测性开销，否则建议保持开启。 |

## YAML 示例

```yaml
http:
  host: 0.0.0.0
  port: 4000
  apiPrefix: /api/v1
storage:
  kind: redis
redis:
  url: redis://127.0.0.1:6379
  keyPrefix: hitl
ttl:
  defaultSeconds: 604800
  answeredRetentionSeconds: 2592000
pending:
  maxWaitSeconds: 0
  waitMode: terminal_only
agentIdentity:
  sessionHeader: x-agent-session-id
  createConflictPolicy: error
observability:
  logLevel: info
  enableMetrics: true
```

## 配置建议

### 本地开发

- `HITL_STORAGE=memory`
- 让客户端或测试工具显式发送 `x-agent-identity`
- `HITL_WAIT_MODE` 保持 `terminal_only`

### 共享开发环境或测试环境

- `HITL_STORAGE=redis`
- 配置真实可达的 `MCP_URL`
- 使用独立的 `HITL_REDIS_PREFIX`
- 确保上游调用方始终发送 `x-agent-identity`

### 生产环境

- `HITL_STORAGE=redis`
- 将 `MCP_URL` 设为外部真实可达 URL
- readiness 探针接 `/api/v1/readyz`
- 明确评审 TTL 和 retention 配置
- 确保上游调用方始终发送 `x-agent-identity`

---

## 内部工作原理

### Scope 状态机

`hitl-mcp` 以 caller scope 为单位维护问题进度。

每次状态变化后，系统都会生成一份 scope snapshot，其中包含：

- pending questions
- answered question IDs
- skipped question IDs
- cancelled question IDs
- changed question IDs
- 是否已完成

这份 snapshot 就是 wait 结果的事实来源。

### Waiter 通知模型

服务端维护一个按 caller scope 建立的进程内 waiter 注册表。

当 answer 或 cancellation 到来时：

1. 先更新存储状态
2. 再计算新的 scope snapshot
3. 通知该 scope 对应的 waiter
4. `hitl_wait` 根据 wait mode 决定如何返回

### 存储选择

当前有两种存储模式：

- **memory**：简单、进程内、本地开发和测试友好
- **redis**：适合多进程和真实部署

当配置为 Redis 但运行时初始化连接失败时，服务会回退到内存存储并记录 warning。

这种回退对本地开发有帮助，但在生产环境中应视为配置或基础设施异常信号。

### 身份处理

对于 HTTP question APIs：

- session 身份来自 `HITL_AGENT_SESSION_HEADER`
- caller identity 来自 `x-agent-identity`

对于 MCP tool calls：

- 服务端先从请求上下文中提取 caller scope
- 再把 caller scope 注入 MCP tool state
- tool handler 从注入后的 state 中读取 `agent_identity` 与 `agent_session_id`

---

## 架构

运行时主要由五层组成。

### 1. 配置层

负责从默认值、YAML、`.env` 和环境变量加载并校验配置。

### 2. Server 层

负责创建 MCP server 与 HTTP app，挂载 middleware，并注册 routes 与 tools。

### 3. Service 层

`HitlService` 定义核心业务行为：

- create
- list pending
- wait
- submit answers
- cancel
- fetch question

这是整个应用最重要的边界层。

### 4. Storage 层

提供两种 repository 实现：

- 面向本地开发和测试的 in-memory 实现
- 面向真实部署的 Redis 实现

### 5. Observability 层

提供：

- 结构化日志
- request ID
- readiness 检查
- metrics 快照

### 请求流摘要

对于 HTTP：

1. auth 与 caller context middleware 解析身份和 session
2. route handler 校验输入并调用 `HitlService`
3. repository 更新状态
4. 最终包装成统一响应信封

对于 MCP：

1. MCP 请求上下文被读取
2. caller scope 被注入到 tool state
3. tool handler 委托 `HitlService`
4. tool 输出返回最新 scope 状态

---

## 运维

## 健康检查与就绪检查

- 存活检查：`GET /api/v1/healthz`
- 就绪检查：`GET /api/v1/readyz`
- 指标接口：`GET /api/v1/metrics`

在 Redis 支撑的生产环境里，真正控制流量放行时应使用 readiness，而不是 liveness。

## 日志

服务默认输出结构化请求日志与错误日志。

排障时可以设置 `HITL_LOG_LEVEL=debug`，以观察更细的请求与仓储行为。

## Metrics

当前 metrics 通过 `/api/v1/metrics` 以 JSON 快照形式暴露。

实现层面已经覆盖诸如 wait 时长和 pending 数量等运行信号。

## 常见部署检查项

上线前至少确认：

1. `MCP_URL` 与外部真实可达地址一致。
2. 暴露端口与运行环境或 ingress 映射一致。
3. `HITL_STORAGE=redis` 时，Redis 实例真实可达。
4. 上游调用方会发送 `x-agent-identity` 和配置中的 session header。
5. `/api/v1/healthz`、`/api/v1/readyz`、`/api/v1/metrics` 都能正确响应。

---

## 项目结构

```text
.
├── config/                     # YAML 配置示例
├── docs/
│   ├── api/                    # MCP tools 和 HTTP API 参考文档
│   └── runbooks/               # 运维 runbook
├── src/
│   ├── config/                 # 配置 schema、默认值、加载逻辑
│   ├── core/                   # HitlService 应用逻辑
│   ├── domain/                 # 领域类型、schema、校验逻辑
│   ├── http/                   # Hono routes、middleware、response helpers
│   ├── mcp/                    # MCP tool 注册与 caller-scope 辅助逻辑
│   ├── observability/          # 日志与 metrics
│   ├── state/                  # waiter 与状态机辅助
│   └── storage/                # 内存与 Redis 仓储实现
├── tests/                      # 单元测试与集成测试
├── Dockerfile                  # 面向生产的容器构建
└── index.ts                    # 运行时入口
```

## 相关文档

- [MCP tools](docs/api/mcp-tools.md)
- [HTTP API](docs/api/http-openapi.md)
- [Production runbook](docs/runbooks/production.md)
- [HITL skill](skills/hitl/SKILL.md)
