---
name: hitl
description: "Use whenever an agent needs structured human input. Agent-side HITL flow is only: hitl_ask, then immediately hitl_wait."
---

# hitl

Use `hitl-mcp` whenever the agent needs a human answer, approval, clarification, or confirmation.

Use HITL when the task cannot safely continue without a human choice, confirmation, approval, or missing business input.

Typical trigger cases:

- multiple valid options exist and the agent should not choose on the user's behalf
- the user explicitly says not to guess or assume
- the action is risky, production-facing, irreversible, or business-sensitive
- a required decision, confirmation, or approval is missing

## Non-Negotiable Rule

`hitl_ask` is never the end of the workflow.

After every `hitl_ask`, the agent MUST immediately call `hitl_wait`.

Do not pause to reason about whether waiting is necessary. Do not treat ask as a notification-only action. Do not leave the question pending for "later" in the same agent flow. If the agent chose to ask, the next tool call must be `hitl_wait`.

Do not model public workflows around request IDs, groups, or interactions.

Critical rule: after every `hitl_ask`, call `hitl_wait` immediately. Asking alone only creates pending questions; it does not consume human feedback.

If the agent calls `hitl_ask` and then ends the turn, returns normal text, or stops before `hitl_wait`, that is a workflow failure.

Do not emit a user-facing completion or handoff message between `hitl_ask` and `hitl_wait`.

## Agent Workflow

1. Call `hitl_ask`.
2. Immediately call `hitl_wait`.
3. Inspect the wait result.
4. If progress is still not terminal, call `hitl_wait` again when appropriate.

Required sequence:

`hitl_ask` -> `hitl_wait`

Required sequence:

`hitl_ask` -> `hitl_wait` -> inspect result -> continue or `hitl_wait` again

Forbidden sequence:

`hitl_ask` -> stop

Forbidden sequence:

`hitl_ask` -> normal user-facing text -> stop

Forbidden sequence:

`hitl_ask` -> do unrelated work -> `hitl_wait`

## Agent Tool Surface

- `hitl_ask`
- `hitl_wait`

For this skill, these are the only HITL tools the agent should care about.

## Wait Semantics

Configured by `HITL_WAIT_MODE`:

- `terminal_only`: return only when no pending questions remain
- `progressive`: return after each question-state change

In progressive mode, call `hitl_wait` again after each response if you still need to observe progress.

Do not treat `hitl_ask` as completion. A correct blocking HITL flow is ask -> wait -> inspect returned progress -> continue or wait again.

`hitl_ask` without the mandatory first `hitl_wait` is an incorrect HITL workflow, even if the question was created successfully.

## Rules

- After every `hitl_ask`, the very next HITL tool call must be `hitl_wait`.
- Never end a HITL interaction on `hitl_ask`.
- Never output a final or handoff-style user message after `hitl_ask` before `hitl_wait` has been called.
- Never stop after `hitl_ask`; always wait for scope progress with `hitl_wait`.
- Do not ask the user in plain text when HITL should be used.
- Do not answer HITL questions on the human's behalf.
- Do not invent public request/group identifiers in agent logic.

## Anti-Patterns

Wrong:

- "I already asked, now I will continue and let the human answer later."
- "This ask is only informational, so I do not need to wait."
- "I will ask several questions and finish this run without calling wait."
- "I will ask the user in normal chat instead of using `hitl_ask`."
- "I already created the HITL question, so I can now just tell the user I am waiting."
- "I will create the HITL question and stop here."

Right:

- "I called `hitl_ask`, so my next step is `hitl_wait`."
- "The wait returned progress; I will inspect it and either continue or wait again."
- "If I need the human answer, I do not proceed past ask without wait."
- "Creating the HITL question is not enough; I must still call `hitl_wait` in the same workflow."

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

Then immediately call `hitl_wait`.
