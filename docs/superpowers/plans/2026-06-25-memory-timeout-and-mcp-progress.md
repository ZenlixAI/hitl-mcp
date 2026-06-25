# Memory Timeout + MCP Progress Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `memory` mode honor `HITL_PENDING_DEFAULT_TIMEOUT_SECONDS` with the same timeout auto-response behavior as `redis`, and make MCP `hitl_wait` emit 30s progress notifications while waiting.

**Architecture:** Extract timeout processing behind a storage-agnostic interface so both repositories can produce the same timeout result shape. Add a lightweight in-process timeout worker for memory mode that polls on the configured interval and notifies the existing waiter. Keep the progress-notification work isolated to the MCP wait tool so HTTP behavior stays unchanged.

**Tech Stack:** TypeScript, Hono, mcp-use, Vitest, in-memory repository, Redis repository, interval timers, MCP notifications

---

### Task 1: Define a storage-agnostic timeout worker contract

**Files:**
- Modify: `src/storage/hitl-repository.ts`
- Modify: `src/storage/in-memory-repository.ts`
- Modify: `src/storage/redis-hitl-repository.ts`

- [ ] **Step 1: Write the failing test**

Add tests that prove `memory` repositories expose the same timeout-processing entry point as `redis` repositories.

```ts
expect(typeof memoryRepo.processTimedOutGroups).toBe('function');
expect(typeof redisRepo.processTimedOutGroups).toBe('function');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/repository-selection.test.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts -v`
Expected: fail because memory has no timeout processor yet.

- [ ] **Step 3: Write minimal implementation**

Add the contract to the repository interface and a no-op compatible implementation shape for memory.

```ts
export interface HitlRepository {
  processTimedOutGroups?(): Promise<TimeoutProcessResult[]>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/repository-selection.test.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts -v`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/hitl-repository.ts src/storage/in-memory-repository.ts src/storage/redis-hitl-repository.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts
git commit -m "feat: add shared timeout processing contract"
```

### Task 2: Add in-process timeout processing for memory mode

**Files:**
- Create: `src/state/memory-timeout-worker.ts`
- Modify: `src/server/create-server.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load-config.ts`
- Modify: `src/core/hitl-service.ts`
- Modify: `src/storage/in-memory-repository.ts`
- Test: `tests/integration/memory-timeout-worker.test.ts`

- [ ] **Step 1: Write the failing test**

Add an integration test that starts the app in `memory` mode, asks with `timeout_seconds: 1`, waits longer than the deadline, and asserts `hitl_wait` returns the completed snapshot with timeout metadata.

```ts
process.env.HITL_STORAGE = 'memory';
process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '1';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/memory-timeout-worker.test.ts -v`
Expected: fail because memory never auto-resolves timed out groups.

- [ ] **Step 3: Write minimal implementation**

Add a memory-only interval worker that calls `repository.processTimedOutGroups()` when available, and notify the existing `Waiter` with each snapshot.

```ts
const worker = new MemoryTimeoutWorker(repository, waiter, config.pending.timeoutPollIntervalSeconds);
worker.start();
```

Thread `defaultTimeoutSeconds` through the existing `HitlService` path unchanged; `memory` should keep honoring `timeout_seconds` and the configured default exactly like `redis`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/memory-timeout-worker.test.ts -v`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/memory-timeout-worker.ts src/server/create-server.ts src/config/types.ts src/config/defaults.ts src/config/load-config.ts src/core/hitl-service.ts src/storage/in-memory-repository.ts tests/integration/memory-timeout-worker.test.ts
git commit -m "feat: enable timeout auto-response in memory mode"
```

### Task 3: Emit 30s progress notifications from `hitl_wait`

**Files:**
- Modify: `src/mcp/tools/wait-question-group.ts`
- Modify: `src/core/hitl-service.ts`
- Test: `tests/integration/mcp-wait-progress.test.ts`

- [ ] **Step 1: Write the failing test**

Add a tool-level integration test that invokes `hitl_wait` with a long wait, stubs a client/session capable server, and asserts at least one `notifications/progress` notification is sent around the 30s mark.

```ts
expect(progressMessages).toContainEqual(
  expect.objectContaining({
    method: 'notifications/progress'
  })
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/mcp-wait-progress.test.ts -v`
Expected: fail because `hitl_wait` currently never calls `ctx.reportProgress()`.

- [ ] **Step 3: Write minimal implementation**

Wrap the wait call in a 30s interval timer inside the MCP tool callback and forward progress through `ctx.reportProgress(…, …, …)` when available.

```ts
const timer = setInterval(() => {
  void ctx?.reportProgress?.(elapsedSeconds, totalSeconds, 'Waiting for human input');
}, 30_000);
```

Use a `try/finally` block so the timer is always cleared when the tool resolves or throws.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/mcp-wait-progress.test.ts -v`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/wait-question-group.ts src/core/hitl-service.ts tests/integration/mcp-wait-progress.test.ts
git commit -m "feat: add progress notifications to hitl wait"
```

### Task 4: Update docs and run the targeted verification suite

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`
- Test: `tests/unit/config-loader.test.ts`
- Test: `tests/integration/wait-modes.test.ts`

- [ ] **Step 1: Write the failing/updated tests**

Extend the config and wait-mode tests to cover:

```ts
expect(config.pending.defaultTimeoutSeconds).toBe(900);
expect(memoryWaitResult.status).toBe('completed');
expect(memoryWaitResult.resolved_questions[0].question.is_timeout_auto_response).toBe(true);
```

- [ ] **Step 2: Run the full targeted suite**

Run:

```bash
npm test -- \
  tests/unit/config-loader.test.ts \
  tests/unit/domain-schemas.test.ts \
  tests/unit/in-memory-repository.test.ts \
  tests/unit/redis-repository.test.ts \
  tests/integration/wait-modes.test.ts \
  tests/integration/memory-timeout-worker.test.ts \
  tests/integration/mcp-wait-progress.test.ts
```

Expected: pass.

- [ ] **Step 3: Update docs**

Document that:

```md
- `HITL_PENDING_DEFAULT_TIMEOUT_SECONDS` controls the default timeout for newly created question groups
- `memory` mode now supports timeout auto-response for single-process deployments
- `hitl_wait` sends progress notifications every 30 seconds in MCP
```

- [ ] **Step 4: Commit**

```bash
git add README.md README-zh.md tests/unit/config-loader.test.ts tests/integration/wait-modes.test.ts
git commit -m "docs: describe timeout and wait progress behavior"
```

### Task 5: Final verification

**Files:**
- All modified files from Tasks 1-4

- [ ] **Step 1: Run the full relevant test set**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Sanity-check the changed flows**

Verify manually that:

```ts
// memory mode
// 1. ask with timeout_seconds omitted
// 2. wait until default timeout expires
// 3. wait returns a completed snapshot with timeout metadata
//
// MCP wait
// 1. start hitl_wait on a long-pending scope
// 2. observe progress notifications every 30 seconds
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: unify timeout auto-response and wait progress"
```
