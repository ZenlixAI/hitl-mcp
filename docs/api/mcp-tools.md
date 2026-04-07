# MCP Tools Contract

## 1) `hitl_create_request`

输入：
- `title` (string)
- `description?` (string)
- `tags?` (string[])
- `extra?` (object)
- `ttl_seconds?` (number)
- `questions` (Question[])
- `idempotency_key?` (string)

行为：
- 从连接认证推导 `agent_identity`
- 从连接 header `x-agent-session-id` 推导 `agent_session_id`
- 生成服务端 `request_id`
- 持久化请求并置为 `pending`

输出：
- `request_id`
- `status`
- 完整 pending 请求对象

## 2) `hitl_wait_request`

输入：
- `request_id?` (string)

行为：
- 如果传入 `request_id`，等待该请求进入终态
- 如果未传入，则等待当前调用方作用域下唯一的 pending 请求

输出：
- `answered`: 返回最终答案
- `cancelled` / `expired`: 返回终态信息

## 3) `hitl_get_current_request`

输入：
- 无

输出：
- 当前调用方作用域下的 pending 请求

## 4) `hitl_get_request_status`

输入：
- `request_id`

输出：
- `request_id`
- `status`
- `updated_at`

## 5) `hitl_get_question`

输入：
- `question_id`

输出：
- 题目完整定义

## 6) `hitl_cancel_request`

输入：
- `request_id`
- `reason?`

输出：
- 取消结果
