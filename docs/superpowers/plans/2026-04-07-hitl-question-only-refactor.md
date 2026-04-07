# HITL Question-Only Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the external HITL API to a question-only model with multiple pending questions, partial answer submission, and configurable terminal/progressive wait behavior.

**Architecture:** Keep the current Hono + MCP runtime and internal repository foundation, but shift public contracts to question-level operations and make waiting scope-based instead of request-based. The server generates `question_id` during create, returns it to clients, and all follow-up question operations key off that server-owned identifier. Introduce incremental question-state persistence and a scope waiter that emits either terminal-only or progressive snapshots depending on configuration.

**Tech Stack:** TypeScript, Hono, mcp-use, Vitest, in-memory repository, Redis repository

---

### Task 1: Add failing tests for question-only MCP and HTTP contracts

**Files:**
- Modify: `tests/integration/mcp-tools-registration.test.ts`
- Modify: `tests/integration/http-questions.test.ts`
- Modify: `tests/unit/domain-schemas.test.ts`
- Create: `tests/integration/http-pending-questions.test.ts`
- Create: `tests/integration/http-submit-answers.test.ts`

- [ ] **Step 1: Write the failing tests for new tool names and routes**
- [ ] **Step 2: Write failing tests that `hitl_ask` / `POST /questions` reject caller-supplied `question_id` and return generated `question_id` values**
- [ ] **Step 2: Run targeted tests and confirm they fail because the old request-based API still exists**

### Task 2: Add failing tests for partial submit and accumulated question state

**Files:**
- Create: `tests/integration/partial-submit.test.ts`
- Modify: `tests/unit/validators.test.ts`
- Modify: `tests/unit/in-memory-repository.test.ts`
- Modify: `tests/unit/redis-repository.test.ts`

- [ ] **Step 1: Write tests that submit only a subset of answers and expect pending questions to remain**
- [ ] **Step 2: Write tests that expect optional skips to accumulate incrementally**
- [ ] **Step 3: Run targeted tests and verify failing behavior**

### Task 3: Add failing tests for configurable wait modes

**Files:**
- Create: `tests/integration/wait-terminal-only.test.ts`
- Create: `tests/integration/wait-progressive.test.ts`
- Modify: `tests/integration/e2e-pending-to-answered.test.ts`
- Modify: `tests/unit/config-loader.test.ts`

- [ ] **Step 1: Write tests for `terminal_only` wait behavior**
- [ ] **Step 2: Write tests for `progressive` wait behavior with one event per state change**
- [ ] **Step 3: Add config loader tests for `HITL_WAIT_MODE`**
- [ ] **Step 4: Run targeted tests and verify they fail**

### Task 4: Refactor schemas, config, and public service layer

**Files:**
- Modify: `src/domain/schemas.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/errors.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load-config.ts`
- Modify: `src/core/hitl-service.ts`

- [ ] **Step 1: Replace request-oriented public schemas with question-oriented ask/get/submit/cancel/wait schemas**
- [ ] **Step 2: Remove caller-supplied `question_id` from ask input schema and add server-generated ID stamping in the create flow**
- [ ] **Step 2: Add `waitMode` to runtime config and loader**
- [ ] **Step 3: Refactor service APIs from request-level calls to scope-based question operations**
- [ ] **Step 4: Run related unit and integration tests**

### Task 5: Refactor persistence to question-level accumulated state

**Files:**
- Modify: `src/storage/hitl-repository.ts`
- Modify: `src/storage/in-memory-repository.ts`
- Modify: `src/storage/redis-hitl-repository.ts`
- Modify: `src/storage/redis-keys.ts`

- [ ] **Step 1: Add repository methods for listing pending questions by scope**
- [ ] **Step 2: Generate `question_id` server-side during create and persist the mapping in both repositories**
- [ ] **Step 3: Replace finalize-only persistence with incremental submit semantics**
- [ ] **Step 4: Track question status and answered/skipped state per question**
- [ ] **Step 4: Run repository tests**

### Task 6: Replace single-id waiter with scope-based versioned waiter

**Files:**
- Modify: `src/state/waiter.ts`
- Modify: `src/server/create-server.ts`
- Modify: `src/core/hitl-service.ts`

- [ ] **Step 1: Change waiter storage from single ID to caller scope/event version**
- [ ] **Step 2: Make service wait return scope snapshots**
- [ ] **Step 3: Ensure progressive mode returns one event per wait call**
- [ ] **Step 4: Run wait-mode tests**

### Task 7: Replace request routes and MCP tools with question-only interfaces

**Files:**
- Modify: `src/http/routes/questions.ts`
- Delete: `src/http/routes/requests.ts`
- Modify: `src/mcp/register-tools.ts`
- Modify: `src/mcp/tools/create-question-group.ts`
- Modify: `src/mcp/tools/get-current-question-group.ts`
- Modify: `src/mcp/tools/get-question-group-status.ts`
- Modify: `src/mcp/tools/wait-question-group.ts`
- Modify: `src/mcp/tools/cancel-question-group.ts`
- Create: `src/mcp/tools/ask.ts` if a clean split is preferable
- Create: `src/mcp/tools/get-pending-questions.ts` if a clean split is preferable
- Create: `src/mcp/tools/submit-answers.ts` if a clean split is preferable
- Create: `src/mcp/tools/cancel-questions.ts` if a clean split is preferable

- [ ] **Step 1: Expose question-only HTTP endpoints**
- [ ] **Step 2: Expose question-only MCP tools**
- [ ] **Step 3: Remove public request terminology from outputs and errors**
- [ ] **Step 4: Run targeted integration tests**

### Task 8: Update docs and skills

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `docs/api/mcp-tools.md`
- Modify: `docs/api/http-openapi.md`
- Modify: `skills/hitl/SKILL.md`

- [ ] **Step 1: Rewrite docs to describe question-only public APIs**
- [ ] **Step 2: Document that `question_id` is server-generated and omitted from ask input**
- [ ] **Step 3: Document partial submit and wait mode configuration**
- [ ] **Step 4: Remove stale request/group terminology from public docs**

### Task 9: Verify full behavior

**Files:**
- No code changes expected

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all Vitest suites pass with 0 failures

- [ ] **Step 2: Review public strings for leaked request/group terminology**

Run: `rg -n "request|group|interaction" README.md README-zh.md docs/api src/mcp src/http`

Expected: internal-only code may still contain storage terms, but public docs/tool names/routes must not expose forbidden terms
