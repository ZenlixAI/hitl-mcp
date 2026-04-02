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
  "finalized_by": "agent-server",
  "extra": {}
}
```

错误：
- `404 QUESTION_GROUP_NOT_FOUND`
- `422 ANSWER_VALIDATION_FAILED`

成功时将 pending 问题组切到 `answered`，并唤醒对应 MCP 阻塞调用。

## POST /api/v1/question-groups/{question_group_id}/cancel

取消问题组并唤醒阻塞调用。

## POST /api/v1/question-groups/{question_group_id}/expire

手动过期问题组并唤醒阻塞调用。

## 鉴权

当环境变量 `HITL_API_KEY` 设置后，以下路径需要请求头 `x-api-key`：
- `/api/v1/question-groups/*`
- `/api/v1/questions/*`

