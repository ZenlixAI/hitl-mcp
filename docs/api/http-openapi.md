# HTTP API

Response envelope:

```json
{
  "request_id": "http-request-id",
  "success": true,
  "data": {},
  "error": null
}
```

## `GET /api/v1/healthz`

Health check.

## `GET /api/v1/readyz`

Readiness check.

## `GET /api/v1/metrics`

Metrics snapshot.

## `POST /api/v1/questions`

Create one or more pending questions for the current caller scope.

Headers:

- `x-agent-session-id`
- `x-agent-identity` when HTTP auth is not enabled
- `x-api-key` when `HITL_API_KEY` is enabled

Body:

```json
{
  "title": "Release Decision",
  "questions": [
    {
      "question_id": "q_canary",
      "type": "single_choice",
      "title": "Can we start canary deployment?",
      "options": [
        { "value": "yes", "label": "Yes" },
        { "value": "no", "label": "No" }
      ]
    }
  ]
}
```

## `GET /api/v1/questions/pending`

Return all pending questions in the current caller scope.

## `POST /api/v1/questions/answers`

Submit newly answered or skipped questions.

Body:

```json
{
  "answers": {
    "q_canary": { "value": "yes" }
  },
  "skipped_question_ids": ["q_note"],
  "idempotency_key": "idem-1"
}
```

Rules:

- answers may contain any subset of pending questions
- optional questions may be skipped explicitly
- required questions cannot be skipped
- progress is accumulated server-side

Errors:

- `422 QUESTION_NOT_FOUND`
- `422 ANSWER_VALIDATION_FAILED`

## `POST /api/v1/questions/cancel`

Cancel pending questions in the current caller scope.

Body:

```json
{
  "question_ids": ["q_canary"],
  "reason": "no longer needed"
}
```

Or:

```json
{
  "cancel_all": true
}
```

## `GET /api/v1/questions/:question_id`

Fetch one question by `question_id`.

Errors:

- `404 QUESTION_NOT_FOUND`
