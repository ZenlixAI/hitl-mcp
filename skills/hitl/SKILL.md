---
name: hitl
description: "Use whenever an agent needs structured human input. Public HITL contract is question-only: ask questions, inspect pending questions, submit partial answers, and wait on caller-scope progress."
---

# hitl

## Overview

Use `hitl-mcp` whenever the agent needs a human answer, approval, clarification, or confirmation.

## Non-Negotiable Rule

`hitl_ask` is never the end of the workflow.

After every `hitl_ask`, the agent MUST immediately call `hitl_wait`.

Do not pause to reason about whether waiting is necessary. Do not treat ask as a notification-only action. Do not leave the question pending for "later" in the same agent flow. If the agent chose to ask, the next tool call must be `hitl_wait`.

The current public model is question-only:

- ask questions
- read pending questions in caller scope
- submit partial answers or skips
- wait on scope progress immediately after asking

Do not model public workflows around request IDs, groups, or interactions.

Critical rule: after every `hitl_ask`, call `hitl_wait` immediately. Asking alone only creates pending questions; it does not consume human feedback.

## Caller Scope

Caller scope is transport-derived:

- `agent_identity`
- `agent_session_id`

The server uses caller scope to isolate pending questions and wait behavior.

## MCP Workflow

1. Call `hitl_ask`.
2. Immediately call `hitl_wait`.
3. Inspect the wait result.
4. If progress is still not terminal, call `hitl_wait` again when appropriate.
5. Use `hitl_get_pending_questions` only to render or recover pending state, never as a substitute for the first post-ask wait.
6. Submit newly answered questions with `hitl_submit_answers`.
7. Optionally skip optional questions with `skipped_question_ids`.
8. Use `hitl_cancel_questions` if pending questions should be cancelled.

Required sequence:

`hitl_ask` -> `hitl_wait` -> inspect result -> continue or `hitl_wait` again

Forbidden sequence:

`hitl_ask` -> stop

Forbidden sequence:

`hitl_ask` -> do unrelated work -> `hitl_wait`

Forbidden sequence:

`hitl_ask` -> `hitl_get_pending_questions` -> stop

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

Do not treat `hitl_ask` as completion. A correct blocking HITL flow is ask -> wait -> inspect returned progress -> continue or wait again.

`hitl_get_pending_questions` is not a replacement for the mandatory first `hitl_wait` after `hitl_ask`.

## Rules

- After every `hitl_ask`, the very next HITL tool call must be `hitl_wait`.
- Never end a HITL interaction on `hitl_ask`.
- Never substitute `hitl_get_pending_questions` for the mandatory post-ask `hitl_wait`.
- Do not send `question_id` when asking questions. The server generates it.
- Multiple pending questions are allowed.
- Partial submission is allowed.
- Optional questions need an explicit skip action if they should be marked ignored.
- Required questions cannot be skipped.
- Never stop after `hitl_ask`; always wait for scope progress with `hitl_wait`.
- Do not invent public request/group identifiers in agent logic.

## Anti-Patterns

Wrong:

- "I already asked, now I will continue and let the human answer later."
- "I can inspect pending questions later instead of waiting now."
- "This ask is only informational, so I do not need to wait."
- "I will ask several questions and finish this run without calling wait."

Right:

- "I called `hitl_ask`, so my next step is `hitl_wait`."
- "The wait returned progress; I will inspect it and either continue or wait again."
- "If I need the human answer, I do not proceed past ask without wait."

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
