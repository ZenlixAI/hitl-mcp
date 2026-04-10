# MCP Tools

## `hitl_ask`

Create one or more pending questions for the current caller scope.

Input questions must not include `question_id`. The server generates it.

Input:

```json
{
  "title": "Release Decision",
  "questions": [
    {
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

Output:

```json
{
  "questions": [
    {
      "question_id": "q_01JXYZ...",
      "status": "pending"
    }
  ]
}
```

## `hitl_wait`

Wait on the current caller scope.

- `terminal_only`: return only when no pending questions remain
- `progressive`: return after each state change

Input:

```json
{}
```

Possible output:

```json
{
  "status": "in_progress",
  "is_terminal": false,
  "changed_question_ids": ["q_canary"],
  "pending_questions": [],
  "resolved_questions": [
    {
      "question": {
        "question_id": "q_canary",
        "type": "boolean",
        "title": "Can we deploy?",
        "status": "answered",
        "answer": { "value": true }
      },
      "status": "answered",
      "answer": { "value": true }
    }
  ],
  "answered_question_ids": ["q_canary"],
  "skipped_question_ids": [],
  "cancelled_question_ids": [],
  "is_complete": true
}
```

## `hitl_get_pending_questions`

Get all pending questions for the current caller scope.

Output:

```json
{
  "pending_questions": [
    {
      "question_id": "q_01JXYZ...",
      "status": "pending"
    }
  ]
}
```

## `hitl_submit_answers`

Submit newly answered or skipped questions.

Input:

```json
{
  "answers": {
    "q_01JXYZ...": { "value": "yes" }
  },
  "skipped_question_ids": ["q_01JABC..."],
  "idempotency_key": "idem-1"
}
```

Output:

```json
{
  "status": "completed",
  "is_terminal": true,
  "changed_question_ids": ["q_01JXYZ...", "q_01JABC..."],
  "pending_questions": [],
  "resolved_questions": [
    {
      "question": {
        "question_id": "q_01JXYZ...",
        "status": "answered",
        "answer": { "value": "yes" }
      },
      "status": "answered",
      "answer": { "value": "yes" }
    },
    {
      "question": {
        "question_id": "q_01JABC...",
        "status": "skipped"
      },
      "status": "skipped"
    }
  ],
  "answered_question_ids": ["q_01JXYZ..."],
  "skipped_question_ids": ["q_01JABC..."],
  "cancelled_question_ids": [],
  "is_complete": true
}
```

## `hitl_cancel_questions`

Cancel a subset of pending questions or all pending questions in scope.

Input:

```json
{
  "question_ids": ["q_01JXYZ..."],
  "reason": "no longer needed"
}
```

Or:

```json
{
  "cancel_all": true
}
```

## `hitl_get_question`

Fetch one question by `question_id`.
