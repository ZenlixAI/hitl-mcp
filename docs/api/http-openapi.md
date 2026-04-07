# HTTP API Contract

统一响应：

```json
{
  "request_id": "uuid",
  "success": true,
  "data": {},
  "error": null
}
```

## GET /api/v1/healthz

返回健康状态。

## GET /api/v1/readyz

返回依赖就绪状态。

## GET /api/v1/metrics

返回服务指标快照。

## GET /api/v1/question-groups/current

按当前调用方作用域返回 pending 问题组。

要求：
- `x-api-key`，当 `HITL_API_KEY` 配置时
- `x-agent-session-id`

错误：
- `404 PENDING_GROUP_NOT_FOUND`

## GET /api/v1/question-groups/{question_group_id}

按 `question_group_id` 查询问题组。

错误：
- `404 QUESTION_GROUP_NOT_FOUND`

## GET /api/v1/questions/{question_id}

按 `question_id` 查询题目。

错误：
- `404 QUESTION_NOT_FOUND`

## PUT /api/v1/question-groups/{question_group_id}/answers/finalize

提交最终答案。

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

错误：
- `404 QUESTION_GROUP_NOT_FOUND`
- `422 ANSWER_VALIDATION_FAILED`

说明：
- 可选题必须“回答或显式忽略（`skipped_question_ids`）”。

成功时将 pending 问题组切到 `answered`，并唤醒对应等待调用。

## POST /api/v1/question-groups/{question_group_id}/cancel

取消问题组并唤醒等待调用。

## POST /api/v1/question-groups/{question_group_id}/expire

手动过期问题组并唤醒等待调用。

## 鉴权

当环境变量 `HITL_API_KEY` 设置后，以下路径需要请求头 `x-api-key`：

- `/api/v1/question-groups/*`
- `/api/v1/questions/*`
