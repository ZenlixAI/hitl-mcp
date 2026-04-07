---
name: hitl
description: "Use whenever an agent needs structured human input. Public HITL contract is question-only: ask questions, inspect pending questions, submit partial answers, and wait on caller-scope progress."
---

# hitl

## Overview

Use `hitl-mcp` whenever the agent needs a human answer, approval, clarification, or confirmation.

The current public model is question-only:

- ask questions
- read pending questions in caller scope
- submit partial answers or skips
- wait on scope progress when blocking is needed

Do not model public workflows around request IDs, groups, or interactions.

## Caller Scope

Caller scope is transport-derived:

- `agent_identity`
- `agent_session_id`

The server uses caller scope to isolate pending questions and wait behavior.

## MCP Workflow

1. Call `hitl_ask`.
2. Continue asynchronously, or call `hitl_wait` if blocking semantics are needed.
3. Use `hitl_get_pending_questions` to render or recover current pending state.
4. Submit newly answered questions with `hitl_submit_answers`.
5. Optionally skip optional questions with `skipped_question_ids`.
6. Use `hitl_cancel_questions` if pending questions should be cancelled.

## Tool Reference

- `hitl_ask`: create one or more pending questions
- `hitl_wait`: wait on current caller scope
- `hitl_get_pending_questions`: list all current pending questions
- `hitl_submit_answers`: submit newly answered or skipped questions
- `hitl_cancel_questions`: cancel some or all pending questions
- `hitl_get_question`: fetch one question by `question_id`

## Wait Semantics

Configured by `HITL_WAIT_MODE`:

- `terminal_only`: return only when no pending questions remain
- `progressive`: return after each question-state change

In progressive mode, call `hitl_wait` again after each response if you still need to observe progress.

## Rules

- Do not send `question_id` when asking questions. The server generates it.
- Multiple pending questions are allowed.
- Partial submission is allowed.
- Optional questions need an explicit skip action if they should be marked ignored.
- Required questions cannot be skipped.
- Do not invent public request/group identifiers in agent logic.

## Minimal Example

Ask:

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
    },
    {
      "type": "text",
      "title": "Anything to note?",
      "required": false
    }
  ]
}
```

Use the returned server-generated `question_id` values in later submit, cancel, and get calls.

Submit part of the progress:

```json
{
  "answers": {
    "q_01JXYZ...": { "value": "yes" }
  }
}
```

Skip the optional remainder:

```json
{
  "skipped_question_ids": ["q_01JABC..."]
}
```
