# hitl skill design (agent-side MCP usage)

## Summary
Create a new agent skill named `hitl` that teaches developers/Coding Agents how to use the `hitl-mcp` MCP tools and the blocking wait behavior. The skill focuses only on the MCP plane and agent-side control flow, not the HTTP finalize/cancel/expire backend workflow.

## Goals
- Teach agents to route **all human questions** (including one-off text questions) through `hitl-mcp`.
- Explain the core blocking workflow: ask a question group, wait, then handle terminal status.
- Provide minimal, practical examples and point to full schemas in existing docs.
- Include a testing/evaluation section aligned to skill-creator and writing-skills guidance (baseline vs with-skill).

## Non-Goals
- No backend HTTP finalize/cancel/expire details.
- No UI rendering guidance or client-specific wiring.
- No full schema duplication (link to existing docs instead).

## Scope
**In scope:**
- MCP tools: `hitl_ask_question_group`, `hitl_get_question_group_status`, `hitl_get_question`, `hitl_cancel_question_group`.
- Blocking semantics and terminal states: `answered`, `cancelled`, `expired`.

**Out of scope:**
- HTTP control plane.
- Storage/Redis setup.

## Skill Structure (SKILL.md)
1. **Frontmatter**
   - `name: hitl`
   - `description`: trigger-only conditions (use when any human question is needed, when structured question groups + stable IDs + blocking wait are required).
2. **Overview**
   - One paragraph describing structured question groups + blocking wait.
3. **When to Use / When Not to Use**
   - Use for **all** human questions (including one-off text questions).
   - Do not use for flows that do not require human input.
4. **Core Workflow (Agent Side)**
   - `hitl_ask_question_group` → block → handle terminal status.
   - Emphasize unique stable IDs and irreversible terminal states.
5. **Tool Quick Reference**
   - 1–2 lines per tool: purpose + required input.
   - Link to `docs/api/mcp-tools.md` for full schema.
6. **Minimal Example**
   - Single minimal JSON example for `hitl_ask_question_group`.
   - Show a compact `answered` result shape.
7. **Common Mistakes**
   - Non-unique IDs, unexpected blocking, treating terminal state as reversible.
8. **Testing & Evaluation**
   - 2–3 test prompts:
     1) basic blocking + answered handling
     2) cancelled/expired terminal handling (agent-side)
     3) query via status/get-question
   - Baseline run without skill vs run with skill.
   - Save prompts to `evals/evals.json`.

## Data Flow (Agent Side)
- Agent calls `hitl_ask_question_group` → server pending → tool blocks → terminal response returned.
- Optional queries: `hitl_get_question_group_status` / `hitl_get_question`.
- Agent branches only on returned terminal status.

## Error Handling & Edge Cases
- Terminal states are final; do not retry finalize from agent side.
- Blocking is expected; treat as explicit wait points.
- If concurrency is needed, isolate lifecycle by `question_group_id`.

## References
- MCP tools schema: `docs/api/mcp-tools.md`
- High-level overview: `README.md`

## Deliverables
- `skills/hitl/SKILL.md` (English).
- `evals/evals.json` with 2–3 prompts.

## Verification
- Validate skill content against references.
- Run baseline vs with-skill evals (per skill-creator/writing-skills).
