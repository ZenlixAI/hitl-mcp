---
name: hitl
description: "Use whenever the task cannot safely continue without structured human input."
---

# hitl

Use `hitl_ask_user` when the task cannot safely continue without a human choice, confirmation, approval, or missing business input.

Typical trigger cases:

- multiple valid options exist and the agent should not choose on the user's behalf
- the user explicitly says not to guess or assume
- the action is risky, production-facing, irreversible, or business-sensitive
- a required decision, confirmation, or approval is missing

## Input Rules

When calling `hitl_ask_user`, always provide:

- a top-level `title` string
- a `questions` array
- at least 1 question in `questions`

Do not send `questions` as a string.

Do not omit the top-level `title`.

Preferred question type order:

1. `boolean`
2. `single_choice`
3. `text`

## Minimal Valid Shapes

### Boolean

```json
{
  "title": "Deployment Approval",
  "questions": [
    {
      "type": "boolean",
      "title": "Can I deploy this change to production?"
    }
  ]
}
```

### Single Choice

```json
{
  "title": "Maintenance Window",
  "questions": [
    {
      "type": "single_choice",
      "title": "Choose the maintenance window",
      "options": [
        { "label": "08:00-09:00", "value": "08:00-09:00" },
        { "label": "20:00-21:00", "value": "20:00-21:00" }
      ]
    }
  ]
}
```

For every `single_choice` option, always include both:

- `label`: what the human sees
- `value`: the machine-readable value

Do not send options like this:

```json
["08:00-09:00", "20:00-21:00"]
```

Do not send options with only `label`.

### Text

```json
{
  "title": "Missing Business Input",
  "questions": [
    {
      "type": "text",
      "title": "What is the required cooling wait time?"
    }
  ]
}
```

### Multiple Questions

```json
{
  "title": "Deployment Prerequisites",
  "questions": [
    {
      "type": "single_choice",
      "title": "Choose the target environment",
      "options": [
        { "label": "staging", "value": "staging" },
        { "label": "production", "value": "production" }
      ]
    },
    {
      "type": "text",
      "title": "Enter the approval ticket number"
    }
  ]
}
```

## After Calling The Tool

`hitl_ask_user` waits internally for the human response.

Do not call it again for the same decision unless you are intentionally asking a new, different question.
