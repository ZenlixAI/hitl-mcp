---
name: hitl
description: Use when any human question is needed in an agent workflow, especially when a structured question group, stable IDs, or blocking wait for final answers are required.
---

# hitl

## Overview
`hitl-mcp` lets agents ask humans structured question groups and **block** until a terminal answer is finalized. Use it for every human question, including one-off text questions, so answers are tracked with stable IDs and the agent only resumes at a terminal state.

## When to Use
- Any time the agent needs input from a human (even a single quick question)
- When you need structured question groups for UI rendering or downstream processing
- When you need stable `question_group_id` / `question_id` identifiers
- When the agent must block until a final answer is confirmed

## When Not to Use
- Purely internal reasoning with no human input
- Fully automated flows that never require human confirmation

## Core Workflow (Agent Side)
1. Call `hitl_ask_question_group` with a **question group** (never a loose question).
2. The MCP call **blocks** until the group reaches a terminal state.
3. Handle the terminal status: `answered`, `cancelled`, or `expired`.

**Key rules**
- Always use a question group, even for a single question.
- Ensure `question_group_id` and `question_id` are unique and stable.
- Blocking is expected. Treat it as an explicit wait point in your agent flow.
- Terminal states are final; do not expect a group to revert to `pending`.

## Tool Quick Reference
- `hitl_ask_question_group`: create a question group and **block** until terminal. Required: `question_group_id`, `title`, `questions`.
- `hitl_get_question_group_status`: check group status by `question_group_id`.
- `hitl_get_question`: fetch a question definition by `question_id`.
- `hitl_cancel_question_group`: cancel a pending group by `question_group_id` (optional `reason`).

Full schema and constraints: `docs/api/mcp-tools.md`.

## Minimal Example

**Ask a single question (still a group):**

```json
{
  "question_group_id": "qg_release_001",
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

**Terminal response (example):**

```json
{
  "question_group_id": "qg_release_001",
  "status": "answered",
  "answers": {
    "q_canary": { "value": "yes" }
  }
}
```

## Common Mistakes
- Reusing IDs across different question groups or questions
- Forgetting that `hitl_ask_question_group` blocks (leading to deadlocks)
- Treating `cancelled` or `expired` as recoverable
