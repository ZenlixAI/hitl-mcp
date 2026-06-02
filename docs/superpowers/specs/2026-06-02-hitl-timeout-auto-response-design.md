# HITL Timeout Auto Response Design

## Summary

This design adds timeout-driven automatic responses for pending HITL questions while preserving backward compatibility for all existing MCP and HTTP request/response shapes.

The feature applies only when the backend storage is Redis. When enabled, a pending question group receives a timeout deadline. If the deadline is reached before a human responds, the server automatically answers each still-pending question with a default answer. The resulting response payload keeps the existing status model and adds metadata fields to mark timeout-generated answers.

## Goals

- Support per-request timeout configuration for question groups.
- Use a configurable default timeout when the caller omits it.
- Support per-question default answers.
- Derive a default answer when the caller omits one.
- Trigger automatic responses only for Redis-backed deployments.
- Mark timeout-generated answers without breaking existing MCP or HTTP payloads.
- Improve MCP tool descriptions so agents are told to prefer explicit default answers and are told the current default timeout.

## Non-Goals

- No timeout processing for in-memory storage.
- No breaking changes to existing MCP or HTTP contracts.
- No new public terminal status values.
- No requirement for callers to provide default answers explicitly.

## User-Facing Behavior

### Request fields

Additive-only request changes:

- `timeout_seconds?: number`
  - Added to question-group creation input.
  - If omitted, server uses the configured default timeout.
- `default_answer?: { value: unknown }`
  - Added to each public ask-question shape.
  - Optional for all question types.

These fields are optional and do not change the validity of existing request bodies.

### Derived defaults

If `default_answer` is omitted, the server derives it by question type:

- `single_choice`: first option value
- `boolean`: first option-equivalent value in canonical order `[true, false]`
- `multi_choice`: array containing the first option value
- `range`: `range_constraints.min`
- `text`: `"none"`

For `boolean`, the public schema remains unchanged. The server will derive `true` as the default if no explicit default is provided.

### Response fields

Additive-only response changes:

- Each persisted/public question may include:
  - `default_answer`
  - `auto_response_at`
- Each resolved question answered by timeout automation may include:
  - `is_timeout_auto_response: true`

Existing fields such as `status`, `answer`, `resolved_questions`, and `answered_question_ids` remain unchanged.

Timeout-generated answers continue to use the existing `answered` status. The distinction is expressed only through the new metadata field.

## Chosen Architecture

The implementation will use a Redis-only active timeout executor based on a polling worker.

### Why polling worker

The repository currently stores full question state in Redis, but waiting is handled in-process. A polling worker is a better fit than lazy expiration because it actively finalizes expired groups without requiring a follow-up read/write call. It also avoids reliance on Redis keyspace notification configuration, which is operationally fragile across environments.

### High-level flow

1. `hitl_ask` or `POST /questions` creates a pending group.
2. The repository persists:
   - derived timeout deadline
   - per-question default answers
   - timeout bookkeeping indexes in Redis
3. A Redis-only timeout worker periodically scans for expired pending groups.
4. For each expired group, the worker atomically:
   - reloads the group
   - finds still-pending questions
   - writes default answers
   - marks those answers as timeout-generated
   - updates group status
   - removes the group from pending indexes if complete
5. The worker publishes the resulting scope snapshot to a notifier channel.
6. The running server receives the event and notifies in-process waiters so `hitl_wait` can return.

## Components

### 1. Schema extension

Files:

- `src/domain/schemas.ts`
- tests covering schema acceptance

Changes:

- Add `timeout_seconds` to `askQuestionsInputSchema`
- Add `default_answer` to each ask-question variant
- Keep schemas strict and backward-compatible

Validation rules:

- `timeout_seconds` must be a positive integer
- `default_answer` must match the existing answer value shape `{ value: ... }`
- Actual semantic validation of `default_answer` is performed against question type rules using existing validator logic

### 2. Config extension

Files:

- `src/config/types.ts`
- `src/config/defaults.ts`
- `src/config/load-config.ts`

Changes:

- Add `pending.defaultTimeoutSeconds`
- Default value: `900`
- Add env override:
  - `HITL_PENDING_DEFAULT_TIMEOUT_SECONDS`

The existing `maxWaitSeconds` config remains unchanged. This new timeout config applies to question auto-response, not to the `hitl_wait` call timeout.

### 3. Domain model extension

Files:

- `src/domain/types.ts`
- repository implementations

Persisted question additions:

- `default_answer?: { value: unknown }`
- `auto_response_at?: string`
- `is_timeout_auto_response?: boolean`

Persisted group additions:

- `timeout_seconds: number`
- `auto_response_deadline_at: string`
- `timeout_status?: 'pending' | 'processed'`

These fields are additive and internal/publicly readable where useful.

### 4. Default answer derivation

Files:

- likely new helper under `src/domain/`

Responsibilities:

- derive server fallback default answer when caller omits one
- validate explicit `default_answer`
- keep rules centralized so create-time validation and timeout execution use the same logic

Failure behavior:

- if caller supplies an invalid `default_answer`, reject create request with existing validation error semantics

### 5. Redis timeout index

Files:

- `src/storage/redis-keys.ts`
- `src/storage/redis-hitl-repository.ts`

Add Redis structures for expiry scheduling:

- sorted set of pending groups keyed by deadline timestamp
- optional lightweight processing lock key per group to prevent duplicate timeout execution across workers

Suggested key shapes:

- deadline zset: `hitl:timeout:due`
- lock key: `hitl:timeout:lock:<groupId>`

On group creation:

- add pending group id to deadline zset with score = deadline epoch millis

On manual completion/cancellation:

- remove group id from deadline zset

### 6. Redis timeout worker

Files:

- new runtime component under `src/state/` or `src/storage/`
- `src/server/create-server.ts`

Responsibilities:

- only start when storage kind is `redis`
- poll Redis deadline zset on a configurable interval
- claim expired groups in small batches
- call repository timeout-finalize method
- publish completed scope snapshots for waiter wake-up

Suggested config:

- internal polling interval constant or config-backed value
- start conservative, e.g. 1000 ms

The worker should be attached at runtime startup and share the same Redis connection strategy or a dedicated safe connection, depending on current client abstraction limits.

### 7. Timeout finalize repository method

Files:

- `src/storage/hitl-repository.ts`
- `src/storage/redis-hitl-repository.ts`
- `src/storage/in-memory-repository.ts`

Add repository capability:

- `processTimedOutGroups?(): Promise<TimeoutProcessResult[]>`
- or narrower methods such as:
  - `findDueTimedOutGroupIds()`
  - `autoRespondTimedOutGroup(groupId)`

Redis implementation must guarantee idempotent processing:

- if multiple app instances poll at the same time, only one finalizes a given group
- if a group was already manually answered, timeout processing becomes a no-op

In-memory implementation:

- may omit the capability or return empty results
- must not perform timeout automation

### 8. Waiter integration

Files:

- `src/state/waiter.ts`
- `src/server/create-server.ts`

Current waiters are in-process only. Because the timeout worker may run in a different process instance than the waiter that is blocked, timeout completion needs a cross-instance event signal.

Chosen approach:

- publish timeout-completion events through Redis pub/sub
- each server instance subscribes to the event channel
- subscriber reconstructs or receives the scope snapshot and calls local `waiter.notify(scopeKey, snapshot)`

This keeps the existing `Waiter` abstraction intact while making timeout completions visible to all instances.

### 9. MCP tool descriptions

Files:

- `src/mcp/tools/create-question-group.ts`
- possibly `src/mcp/tools/wait-question-group.ts`
- documentation files under `docs/api/`

Changes:

- update `hitl_ask` description to tell agents:
  - explicit `default_answer` is recommended
  - if omitted, server derives one
  - current default timeout is 900 seconds unless overridden
- keep schema-compatible input shape
- optionally include the same guidance in README/docs

Because tool descriptions are static strings today, runtime config and description can diverge. The implementation should prefer reading the configured default timeout at registration time so the description reflects the actual runtime value.

## Data Flow Details

### Create flow

1. Parse `askQuestionsInputSchema`
2. Resolve effective timeout:
   - `input.timeout_seconds ?? config.pending.defaultTimeoutSeconds`
3. For each question:
   - derive or validate `default_answer`
4. Persist group with:
   - generated `question_id`
   - resolved `default_answer`
   - deadline metadata
5. In Redis mode:
   - enqueue group into timeout zset
6. Return existing create response plus additive fields

### Human answer flow

1. Validate submitted answers as today
2. Persist answer state
3. Remove completed group from timeout zset when no pending question remains
4. Notify waiters as today

### Timeout auto-response flow

1. Worker finds due pending group ids
2. Worker locks one group
3. Repository reloads current group
4. For each pending question:
   - set `answer = default_answer`
   - set `status = answered`
   - set `is_timeout_auto_response = true`
   - set `auto_response_at = now`
5. Recompute group status
6. Update question and group records
7. Remove deadline entry
8. Build scope snapshot
9. Publish snapshot event for waiter wake-up

## Error Handling

- Invalid explicit `default_answer` fails create with existing validation failure behavior.
- Timeout worker must ignore groups that are already terminal.
- Timeout worker must treat missing groups as stale schedule entries and clean them up.
- Pub/sub notification failure should be logged; timeout persistence must not roll back after data is committed.
- Redis unavailable at startup should preserve existing fallback-to-memory behavior, which implicitly disables timeout automation.

## Compatibility Rules

To satisfy compatibility requirements:

- No existing request field is removed.
- No existing response field is removed.
- No existing field changes meaning in an incompatible way.
- No new public status enum is introduced.
- All additions are optional or additive.

Existing clients that ignore unknown fields continue to work unchanged.

## Testing Strategy

### Unit tests

- schema accepts `timeout_seconds` and `default_answer`
- schema still accepts old request shape
- default derivation helper returns correct fallback for each question type
- explicit invalid `default_answer` is rejected

### Redis repository tests

- create persists deadline and derived default answers
- timeout worker auto-answers pending questions
- resolved timeout answers include `is_timeout_auto_response`
- manual answer before deadline prevents timeout overwrite
- completed/cancelled groups are removed from timeout zset
- duplicate workers do not double-process the same group

### Integration tests

- Redis-backed runtime wakes `hitl_wait` after timeout automation
- timeout metadata is visible through HTTP and MCP outputs
- memory-backed runtime never auto-responds on timeout
- MCP tool registration includes updated guidance text

## Open Implementation Decisions

These are implementation details, not product-open questions:

- whether timeout polling interval is hardcoded or config-driven
- whether timeout pub/sub shares the main Redis client or uses dedicated subscriber connection
- exact repository interface name for timeout processing

All can be decided in the implementation plan without changing user-visible behavior.

## Recommended Implementation Order

1. Extend schemas and config
2. Add default-answer derivation/validation helper
3. Extend Redis key model and group persistence
4. Add timeout processing method in Redis repository
5. Add polling worker and pub/sub notification wiring
6. Update MCP tool descriptions
7. Add tests for compatibility and timeout behavior
