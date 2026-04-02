# hitl Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an English `hitl` skill under `skills/` that teaches agents to use `hitl-mcp` MCP tools (blocking ask + terminal states), and add eval prompts to validate behavior.

**Architecture:** The skill is a single `SKILL.md` file with concise guidance, minimal examples, and references to existing docs. Evals live in `evals/evals.json` to drive baseline vs with-skill testing.

**Tech Stack:** Markdown (`SKILL.md`), JSON (`evals/evals.json`)

---

## File Structure

- Create: `skills/hitl/SKILL.md` — the skill document
- Create: `evals/evals.json` — test prompts for baseline vs with-skill comparison

---

### Task 1: Create Eval Prompts (RED phase)

**Files:**
- Create: `evals/evals.json`

- [ ] **Step 1: Create `evals/evals.json` with 3 prompts**

```json
{
  "skill_name": "hitl",
  "evals": [
    {
      "id": 1,
      "prompt": "You are building an agent workflow and need to ask a human a single yes/no question before continuing. Show the exact MCP tool call you would use (with a minimal question group) and explain what the agent should do while waiting for the answer.",
      "expected_output": "Uses hitl_ask_question_group with a question group, explains blocking wait and terminal status handling.",
      "files": []
    },
    {
      "id": 2,
      "prompt": "Your agent already asked a question group and now needs to check its status before proceeding. Show which MCP tool to call and what minimal input it needs.",
      "expected_output": "Uses hitl_get_question_group_status with question_group_id; mentions returned status and updated_at.",
      "files": []
    },
    {
      "id": 3,
      "prompt": "A human question was asked via hitl-mcp but the group was cancelled. What should the agent do next, and what MCP tool could it use to cancel when needed?",
      "expected_output": "Mentions terminal cancelled status, no further waiting; uses hitl_cancel_question_group with question_group_id if agent needs to cancel.",
      "files": []
    }
  ]
}
```

- [ ] **Step 2: Commit eval prompts**

```bash
git add evals/evals.json
git commit -m "test: add eval prompts for hitl skill"
```

---

### Task 2: Run Baseline (No Skill) Evaluations

**Files:**
- Use: `evals/evals.json`

- [ ] **Step 1: Run baseline responses without the skill**

Follow the skill-creator guidance for baseline runs (no skill). For each eval prompt in `evals/evals.json`, record the baseline output and note any failures or omissions (e.g., not using `hitl_ask_question_group`, missing blocking semantics).

- [ ] **Step 2: Save baseline notes**

Create a notes file capturing baseline failures:

```bash
mkdir -p evals/notes
cat <<'NOTE' > evals/notes/baseline.md
# Baseline (no skill) notes

- Eval 1: 
- Eval 2: 
- Eval 3: 
NOTE
```

- [ ] **Step 3: Commit baseline notes**

```bash
git add evals/notes/baseline.md
git commit -m "docs: record baseline eval notes for hitl skill"
```

---

### Task 3: Write the `hitl` Skill (GREEN phase)

**Files:**
- Create: `skills/hitl/SKILL.md`

- [ ] **Step 1: Create `skills/hitl/SKILL.md`**

```markdown
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

## Testing & Evaluation
- Create baseline responses **without** this skill (expect violations like missing blocking semantics).
- Run the same prompts **with** this skill and compare.
- Use `evals/evals.json` for prompts and record observations.
```

- [ ] **Step 2: Commit the skill file**

```bash
git add skills/hitl/SKILL.md
git commit -m "docs: add hitl agent skill"
```

---

### Task 4: Run With-Skill Evaluations (GREEN verification)

**Files:**
- Use: `skills/hitl/SKILL.md`
- Use: `evals/evals.json`

- [ ] **Step 1: Run each eval prompt with the skill enabled**

Follow skill-creator guidance to run the same prompts with the skill loaded. Verify outputs:
- Use `hitl_ask_question_group` for any human question
- Mention blocking wait and terminal status handling
- Use appropriate status/get/cancel tools when asked

- [ ] **Step 2: Record with-skill notes**

```bash
cat <<'NOTE' > evals/notes/with-skill.md
# With-skill notes

- Eval 1: 
- Eval 2: 
- Eval 3: 
NOTE
```

- [ ] **Step 3: Commit with-skill notes**

```bash
git add evals/notes/with-skill.md
git commit -m "docs: record with-skill eval notes for hitl"
```

---

### Task 5: Refine (REFACTOR if needed)

**Files:**
- Modify: `skills/hitl/SKILL.md`

- [ ] **Step 1: Update the skill to address any observed gaps**

Apply concise fixes only if baseline vs with-skill comparison shows issues (e.g., missing blocking semantics, not enforcing "all human questions" rule).

- [ ] **Step 2: Re-run affected evals and update notes**

Repeat Task 4 for affected prompts, then update `evals/notes/with-skill.md` with the corrections.

- [ ] **Step 3: Commit refinements**

```bash
git add skills/hitl/SKILL.md evals/notes/with-skill.md
git commit -m "docs: refine hitl skill after evals"
```

---

## Self-Review Checklist
- All spec requirements are covered by a task above.
- No placeholder language in the plan.
- Tool names and IDs are consistent across tasks.
- "All human questions must use hitl-mcp" is explicitly enforced.

## Execution Handoff
Plan complete and saved to `docs/superpowers/plans/2026-04-02-hitl-skill-implementation.md`.

Two execution options:
1. **Subagent-Driven (recommended)** — Use `superpowers:subagent-driven-development` to execute each task.
2. **Inline Execution** — Use `superpowers:executing-plans` in this session.

Which approach?
