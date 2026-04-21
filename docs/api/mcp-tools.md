# MCP Tools

`hitl-mcp` currently exposes only the single agent-facing MCP tool below.

Human/UI/backend-side operations such as listing pending questions, submitting answers, cancelling questions, and fetching one question should use the HTTP API instead of MCP tools.

## `hitl_ask_user`

Create one or more pending questions for the current caller scope and perform the initial wait.

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
  ],
  "wait": {
    "status": "completed",
    "is_terminal": true,
    "pending_questions": [],
    "resolved_questions": [
      {
        "question_id": "q_01JXYZ...",
        "status": "answered"
      }
    ],
    "answered_question_ids": ["q_01JXYZ..."],
    "skipped_question_ids": [],
    "cancelled_question_ids": [],
    "changed_question_ids": ["q_01JXYZ..."],
    "is_complete": true
  }
}
```

Notes:

- With question input, the tool creates the question(s) and performs the initial wait automatically.
- To continue waiting on the current caller scope after a non-terminal return, call the same tool again with:

```json
{}
```

- The same tool supports both modes:
  - question payload -> ask and perform the initial wait
  - `{}` -> continue waiting on the current caller scope
- `terminal_only`: return only when no pending questions remain
- `progressive`: return after each state change
- `hitl_ask_user` waits internally and returns control to the Agent only after the wait reaches a terminal state.
