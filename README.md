# hitl-mcp

A Human-in-the-loop MCP server for agentic systems.

`hitl-mcp` gives an AI Agent a reliable way to ask structured questions, pause execution, and resume only after a server-side finalized human answer is submitted through HTTP.

## Why This Exists

In complex agent workflows, plain assistant text questions are not enough:
- They are not strongly structured for UI rendering.
- They do not provide stable `question_group_id` / `question_id` tracking.
- They are hard to post-process on the backend before finalizing.

Existing CLI/TUI-first approaches also create integration friction for web products:
- UI is coupled to the MCP server runtime.
- No clean HTTP control plane for backend orchestration.
- Harder global persistence and cross-session state recovery.

`hitl-mcp` is designed to solve these issues with a protocol-first, backend-friendly model.

## Product Goals

- Always ask in **Question Group** form, never single loose questions.
- Keep MCP call **pending** until HTTP finalization arrives.
- Support rich question types:
  - `single_choice`
  - `multi_choice`
  - `text`
  - `boolean`
  - `range`
- Support required (default) and optional questions.
- Preserve structured IDs and metadata (`tags`, `extra`) for both group and question.
- Provide a no-list HTTP control plane (ID-oriented operations only).
- Support persistence and TTL through KV storage (Redis).

## Who Uses It

### For Agent Developers
You register `hitl-mcp` in your MCP client and call tools like:
- `hitl_ask_question_group`
- `hitl_get_question_group_status`
- `hitl_get_question`
- `hitl_cancel_question_group`

Your agent can safely block on human decisions without inventing custom polling logic.

### For Backend Developers
You integrate HTTP endpoints to finalize answers after your own post-processing:
- `PUT /api/v1/question-groups/{id}/answers/finalize`
- `POST /api/v1/question-groups/{id}/cancel`
- `POST /api/v1/question-groups/{id}/expire`
- `GET /api/v1/question-groups/{id}`
- `GET /api/v1/questions/{id}`

No list APIs are exposed by design.

## User Story (End-to-End)

1. Agent calls `hitl_ask_question_group` with structured questions.
2. `hitl-mcp` stores state as `pending` and blocks that MCP call.
3. Client UI renders cards using question IDs.
4. User answers in client UI.
5. Your backend post-processes the raw user response.
6. Backend calls `answers/finalize` HTTP API.
7. `hitl-mcp` validates answers:
   - invalid -> returns `422 ANSWER_VALIDATION_FAILED`, keeps `pending`
   - valid -> transitions to `answered`, wakes blocked MCP call
8. Agent resumes with finalized answer payload.

## Key Design Decisions

### 1) Blocking Ask Tool (Intentional)
`hitl_ask_question_group` blocks by default. This guarantees the agent remains pending until finalization is explicit.

### 2) Question Group First
All questions are grouped. This gives deterministic UI state and stable lifecycle management.

### 3) ID-Only Control Plane
No list endpoints. Every operation requires `question_group_id` or `question_id`, which keeps API surface predictable and safer for large-scale systems.

### 4) MCP Plane + HTTP Plane
- MCP plane: ask and wait semantics for the model.
- HTTP plane: operational control for backend systems.

### 5) Validation + Idempotency
Finalize validates required fields and type/range constraints. Duplicate finalize requests can be idempotent via `idempotency_key`.

### 6) Storage Strategy
- In-memory repository for local/dev flow.
- Redis repository for persistent KV state and TTL.
- Optional fallback to memory when Redis is configured but unavailable.

## Current Capabilities

- Structured question schemas and validators.
- MCP tools for ask/status/question/cancel.
- HTTP routes for query/finalize/cancel/expire/healthz.
- State machine: `pending -> answered|cancelled|expired`.
- Wait/notify mechanism for blocked MCP asks.
- API key middleware (`x-api-key`) for HTTP APIs (when enabled).
- Redis-backed repository with tests.

## Quick Start

```bash
npm install
npm run dev
```

Default port: `3000`

Health check:

```bash
npx hono request hono.request.ts -P /api/v1/healthz
```

## Configuration

Environment variables:

- `PORT` (default `3000`)
- `MCP_URL` (default `http://localhost:3000`)
- `HITL_PENDING_MAX_WAIT_SECONDS` (`0` means infinite wait)
- `HITL_STORAGE` (`memory` | `redis`)
- `HITL_REDIS_URL` (default `redis://127.0.0.1:6379`)
- `HITL_REDIS_PREFIX` (default `hitl`)
- `HITL_TTL_SECONDS` (default `604800`)
- `HITL_API_KEY` (when set, HTTP protected routes require `x-api-key`)

## Usage Examples

### Agent: Ask a Question Group

Tool: `hitl_ask_question_group`

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

### Backend: Finalize Answer

```bash
curl -X PUT "http://localhost:3000/api/v1/question-groups/qg_release_001/answers/finalize" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${HITL_API_KEY}" \
  -d '{
    "idempotency_key": "idem-release-001",
    "answers": {
      "q_canary": { "value": "yes" }
    },
    "finalized_by": "release-orchestrator"
  }'
```

## Detailed MCP Tool Specification

### 1) `hitl_ask_question_group`

Purpose:
- Create a question group and block until it reaches a terminal state (`answered`, `cancelled`, `expired`).

Input (important fields):
- `question_group_id` (string, required)
- `title` (string, required)
- `description` (string, optional, markdown)
- `tags` (string[], optional)
- `extra` (object, optional)
- `ttl_seconds` (number, optional)
- `questions` (array, required)
- `idempotency_key` (string, optional)
- `metadata.agent_session_id` / `metadata.agent_trace_id` (optional)

Question types:
- `single_choice` with `options[]`
- `multi_choice` with `options[]`
- `text` with optional `text_constraints`
- `boolean`
- `range` with `range_constraints`

Output:
- On finalize success: status `answered` + validated `answers`
- On cancel: status `cancelled`
- On expire: status `expired`

Notes:
- This tool is intentionally blocking.
- If `HITL_PENDING_MAX_WAIT_SECONDS=0`, wait is unbounded.

### 2) `hitl_get_question_group_status`

Purpose:
- Query group lifecycle state by ID.

Input:
- `question_group_id` (string)

Output:
- `question_group_id`
- `status` (`pending|answered|cancelled|expired`)
- `updated_at`

### 3) `hitl_get_question`

Purpose:
- Fetch one question definition by `question_id`.

Input:
- `question_id` (string)

Output:
- Full question object.

### 4) `hitl_cancel_question_group`

Purpose:
- Cancel a pending group and wake blocked ask call.

Input:
- `question_group_id` (string)
- `reason` (string, optional)

Output:
- `status: "cancelled"`
- Optional `reason`

## Detailed HTTP API Specification

Base path:
- `/api/v1`

Common response envelope:

```json
{
  "request_id": "uuid",
  "success": true,
  "data": {},
  "error": null
}
```

### `GET /healthz`

Purpose:
- Liveness check.

Success:
- `200` with `data.status = "ok"`.

### `GET /question-groups/{question_group_id}`

Purpose:
- Fetch a question group by ID.

Errors:
- `404 QUESTION_GROUP_NOT_FOUND`

### `GET /questions/{question_id}`

Purpose:
- Fetch one question by ID.

Errors:
- `404 QUESTION_NOT_FOUND`

### `PUT /question-groups/{question_group_id}/answers/finalize`

Purpose:
- Submit final, post-processed answers from backend.

Request body:

```json
{
  "idempotency_key": "idem-1",
  "answers": {
    "q_1": { "value": "A" }
  },
  "finalized_by": "agent-server",
  "extra": {}
}
```

Behavior:
- Validates answer type/range/required rules.
- If invalid: keeps group `pending`.
- If valid: transitions group to `answered` and wakes blocked MCP ask.

Success:
- `200` with `status: "answered"` and `answered_question_ids`.

Validation error:
- `422 ANSWER_VALIDATION_FAILED` with per-question details.

Idempotency:
- Reusing same `idempotency_key` returns same finalize result.

### `POST /question-groups/{question_group_id}/cancel`

Purpose:
- Cancel a pending group.

Behavior:
- Marks group `cancelled`.
- Wakes blocked MCP ask with terminal state.

### `POST /question-groups/{question_group_id}/expire`

Purpose:
- Force-expire a group.

Behavior:
- Marks group `expired`.
- Wakes blocked MCP ask with terminal state.

### Authentication

When `HITL_API_KEY` is set:
- Protected routes require `x-api-key`.
- Missing/invalid key returns `401 UNAUTHORIZED`.

### Error codes used by HTTP APIs

- `QUESTION_GROUP_NOT_FOUND` (`404`)
- `QUESTION_NOT_FOUND` (`404`)
- `ANSWER_VALIDATION_FAILED` (`422`)
- `UNAUTHORIZED` (`401`)

## API References

- MCP tools: [docs/api/mcp-tools.md](docs/api/mcp-tools.md)
- HTTP API: [docs/api/http-openapi.md](docs/api/http-openapi.md)
- Design document: [docs/design-doc.md](docs/design-doc.md)

## Development

Run tests:

```bash
npm run test
```

Current test suite covers unit and integration scenarios, including pending-to-answered flow and idempotency.

## Project Status

This repository currently provides the core HITL interaction loop and integration surfaces. Additional hardening can still be added for full production rollouts (for example stronger auth modes, metrics export, and operational runbooks).
