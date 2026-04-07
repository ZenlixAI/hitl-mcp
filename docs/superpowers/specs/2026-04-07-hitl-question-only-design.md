# HITL Question-Only API Design

## Goal
Refactor the external MCP and HTTP API so the public model is question-only, supports multiple pending questions at once, supports partial answer submission with server-side accumulation, and allows `wait` behavior to switch between terminal-only and progressive modes via configuration.

## Context
The current API still exposes an external request/container concept even after renaming away from `group`. That still leaks internal batching semantics. The target design is to make the external contract operate only on questions plus caller-scope pending state.

The system may keep an internal batching/instance concept for persistence and bookkeeping, but that concept must not appear in public tool names, HTTP routes, request schemas, response schemas, or documentation.

## Core Decisions

### 1. Public model is question-only
Public APIs expose:
- questions
- current pending question state for the caller scope
- answer submission by `question_id`
- scope-level wait semantics

Public APIs do not expose:
- request
- group
- interaction
- batch

### 2. Multiple pending questions are allowed
The caller scope may have multiple pending questions at the same time.

Questions may be created in a single `ask` call, but that ask call is not surfaced as a first-class public object after creation.

### 3. Wait is scope-based, not object-based
`wait` observes question-state changes within the caller scope.

This means:
- `wait` does not take a request/container identifier
- `wait` returns either when all pending questions are done or when question progress changes, depending on configuration

### 4. Partial submission is incremental
Clients may submit only the newly answered/skipped subset of questions. The server accumulates progress.

Submission semantics:
- `answers` may include any subset of pending questions
- `skipped_question_ids` may include any subset of optional pending questions
- previously stored answers/skips remain unless explicitly overwritten is later introduced

### 5. Default answer writes are append-only
For this phase, previously answered questions are not overwritten. This avoids conflict and simplifies storage, auditing, and progressive wait semantics.

If a client re-submits an already answered question, the server should reject it as invalid or idempotently ignore it if the payload matches the stored value. Exact handling should be specified in implementation.

## Public API Shape

### MCP tools
- `hitl_ask`
- `hitl_wait`
- `hitl_get_pending_questions`
- `hitl_submit_answers`
- `hitl_cancel_questions`
- `hitl_get_question`

### HTTP routes
- `POST /api/v1/questions`
- `GET /api/v1/questions/pending`
- `POST /api/v1/questions/answers`
- `POST /api/v1/questions/cancel`
- `GET /api/v1/questions/:question_id`

## Public Data Model

### Question
Each question includes:
- `question_id`
- `title`
- `description?`
- `type`
- `required`
- `status`: `pending | answered | skipped | cancelled`
- `answer?`
- `created_at`
- `updated_at`
- `extra?`
- `tags?`

`question_id` is server-generated. Public create inputs do not accept caller-supplied `question_id`.

### Pending question snapshot
Scope-level snapshot includes:
- `pending_questions`
- `answered_question_ids`
- `skipped_question_ids`
- `cancelled_question_ids`
- `is_complete`

`pending_questions` contains the full remaining question objects that still require action.

## Wait Behavior

Configuration:
- `HITL_WAIT_MODE=terminal_only|progressive`
- default: `terminal_only`

### terminal_only
`wait` blocks until the caller scope has no pending questions left.

Return payload:
- `status: "completed" | "cancelled" | "expired"`
- `is_terminal: true`
- `pending_questions: []`
- `answers`
- `skipped_question_ids`
- `cancelled_question_ids`

### progressive
`wait` returns once per question-state change event.

Return payload:
- `status: "in_progress" | "completed" | "cancelled" | "expired"`
- `is_terminal: boolean`
- `changed_question_ids`
- `answered_question_ids`
- `skipped_question_ids`
- `cancelled_question_ids`
- `pending_questions`

In progressive mode:
- if pending questions still exist after a submission/cancel action, return `status: "in_progress"`
- if no pending questions remain, return a terminal payload
- each `wait` call returns one event only; callers re-issue `wait` if they want to continue observing

## Submit Semantics

### `POST /questions/answers`
Input:
- `answers?: Record<string, { value: unknown }>`
- `skipped_question_ids?: string[]`
- `idempotency_key?: string`

Validation rules:
- answer targets must exist and still be pending
- skipped targets must exist, still be pending, and be optional
- required questions cannot be skipped
- answered and skipped sets must not overlap
- partial submission is valid
- full completion is not required for a successful submit

Result:
- updated question statuses are persisted
- current pending question snapshot is returned
- scope waiters are notified of the state change

### `POST /questions`
Input question definitions include content only:
- `title`
- `description?`
- `type`
- type-specific constraints/options
- `required`
- `extra?`
- `tags?`

They do not include `question_id`.

On creation, the server stamps each question with a generated `question_id` and returns that identifier in the created question objects.

## Cancel Semantics

### `POST /questions/cancel`
Input:
- `question_ids?: string[]`
- `cancel_all?: boolean`
- `reason?: string`

Rules:
- either `question_ids` or `cancel_all=true`
- cancellation only applies to pending questions
- after cancellation, waiters are notified with the new scope snapshot

## Internal Model
Internally, the system may continue storing a hidden grouping/batch/instance concept to preserve shared metadata and write-path simplicity. That internal concept:
- is not returned publicly
- is not accepted as public input
- is not named in docs or tool descriptions

Questions remain the public unit of work.

## Waiter Design
The current waiter is keyed by a single identifier and resolves once. That is insufficient for scope-level question progress.

The new waiter should be keyed by caller scope and event version:
- store waiters by `(agent_identity, agent_session_id)`
- persist or compute a monotonically increasing scope version
- `wait` records the current version and blocks until it changes
- event payload is derived from the current scope snapshot plus changed question IDs

This supports:
- multiple concurrent pending questions
- progressive events
- terminal-only events

## Error Handling
Public errors should remain question-oriented:
- `QUESTION_NOT_FOUND`
- `PENDING_QUESTIONS_NOT_FOUND` or equivalent scope-empty error
- `ANSWER_VALIDATION_FAILED`
- `QUESTION_ALREADY_ANSWERED` or equivalent if append-only behavior rejects duplicate answers

No public error should mention request/group/interaction.

## Documentation Impact
Update:
- README
- README-zh
- MCP tools docs
- HTTP API docs
- skill docs

The docs must consistently describe:
- questions as the public unit
- scope-level pending state
- partial submission
- configurable wait modes

## Testing Requirements
Required coverage:
- create multiple questions in one ask
- reject caller-supplied `question_id` in ask input
- return server-generated `question_id` values from ask
- fetch all pending questions in scope
- partial answer submission accumulates state
- optional question skip works incrementally
- terminal-only wait blocks until no pending questions remain
- progressive wait returns after each state change
- multiple pending questions coexist correctly
- cancelling a subset of questions updates pending snapshot correctly
- duplicate answer submission behavior is enforced
