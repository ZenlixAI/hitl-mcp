# MCP Tools Contract

## 1) hitl_ask_question_group

输入：
- `question_group_id` (string)
- `title` (string)
- `description?` (string)
- `tags?` (string[])
- `extra?` (object)
- `ttl_seconds?` (number)
- `questions` (Question[])
- `idempotency_key?` (string)
- `metadata?` ({ agent_session_id?, agent_trace_id? })

行为：
- 持久化问题组并置为 `pending`
- 阻塞等待 `finalize` / `cancel` / `expire`

输出：
- `answered`: 返回最终答案
- `cancelled` / `expired`: 返回终态信息

## 2) hitl_get_question_group_status

输入：`question_group_id`

输出：
- `question_group_id`
- `status`
- `updated_at`

## 3) hitl_get_question

输入：`question_id`

输出：题目完整定义

## 4) hitl_cancel_question_group

输入：
- `question_group_id`
- `reason?`

输出：取消结果

