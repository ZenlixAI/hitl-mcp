# hitl-mcp

Question-only HITL MCP server for agent workflows.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-green.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | [中文](README-zh.md)

---

## Table of Contents

- [Background](#background)
- [What hitl-mcp is](#what-hitl-mcp-is)
- [Goals](#goals)
- [Non-goals](#non-goals)
- [Core model](#core-model)
- [Quick start](#quick-start)
- [How interaction works](#how-interaction-works)
- [MCP tools](#mcp-tools)
- [HTTP API](#http-api)
- [Runtime configuration](#runtime-configuration)
- [How it works internally](#how-it-works-internally)
- [Architecture](#architecture)
- [Operations](#operations)
- [Project structure](#project-structure)

---

## Background

In many Agent systems, the Agent eventually reaches a point where it cannot continue autonomously:

- a human must approve or reject a decision
- a human must choose one option from several candidates
- a human must provide missing business input
- a workflow must pause until manual confirmation arrives

Without a dedicated HITL layer, these workflows are usually implemented with ad hoc prompts, side-channel UIs, or custom callback protocols. That creates three recurring problems:

1. The Agent and the application do not share a stable model for "pending human input".
2. Human answers are hard to correlate with the exact Agent run and session that requested them.
3. Waiting, partial submission, cancellation, and recovery semantics become inconsistent across clients.

`hitl-mcp` solves this by exposing a narrow, explicit contract for human questions:

- Agents create questions
- clients or operator UIs read pending questions
- humans answer, skip, or cancel them
- Agents wait on a caller-scoped state machine until work is complete

---

## What hitl-mcp is

`hitl-mcp` is a **question-oriented human-in-the-loop server** built on MCP and HTTP.

It provides two access surfaces over the same underlying state:

- **MCP tools** for Agents and Agent platforms
- **HTTP APIs** for operator consoles, backends, or custom approval UIs

The public abstraction is intentionally small:

- the public unit is `question`
- questions belong to a **caller scope**
- answers may be submitted incrementally
- waiting is modeled as a scope-level operation, not a question-level long poll

The server is designed for workflows where the Agent is the initiator, but a human completes part of the decision loop.

---

## Goals

- Provide a stable, minimal HITL contract for Agent workflows.
- Make caller isolation explicit through `agent_identity` and `agent_session_id`.
- Support multiple pending questions in the same caller scope.
- Support partial progress instead of forcing an all-at-once final submission.
- Allow MCP and HTTP clients to operate on the same underlying question state.
- Keep storage pluggable so local development can use memory and production can use Redis.
- Keep operational behavior observable through health, readiness, metrics, and structured logs.

---

## Non-goals

- Not a generic workflow engine.
- Not a UI framework for approval consoles.
- Not a task queue or event bus.
- Not a general-purpose form builder.
- Not a policy engine for access control and reviewer assignment.
- Not a durable orchestration platform for arbitrary business processes.

`hitl-mcp` only manages question state, caller scoping, waiting semantics, and answer submission.

---

## Core model

### Public unit: question

Externally, the system only exposes `question`.

A question has:

- a server-generated `question_id`
- a `type`
- prompt metadata such as `title`, `description`, `tags`, and `extra`
- a status such as `pending`, `answered`, `skipped`, or `cancelled`

Supported question types:

- `single_choice`
- `multi_choice`
- `text`
- `boolean`
- `range`

### Caller scope

Every operation is scoped by:

- `agent_identity`
- `agent_session_id`

This scope is the isolation boundary for:

- creating questions
- listing pending questions
- waiting for progress
- submitting answers
- cancelling questions

Two Agents can ask identical questions without colliding as long as their caller scopes differ.

### Internal groups vs public API

The storage layer may still use grouping internally, but grouping is an implementation detail.

The public API is intentionally question-first:

- create questions
- fetch pending questions
- submit answers by `question_id`
- cancel by `question_id`
- wait on the scope

### Partial submission

Answers do not need to arrive in one batch.

The server accepts incremental progress:

- answer one question now
- answer another question later
- skip optional questions explicitly
- continue waiting until the scope becomes complete

### Wait modes

`hitl_wait` and the equivalent scope-level wait behavior support two modes:

- `terminal_only`: return only when the scope has no pending questions left
- `progressive`: return after every state change, then let the caller wait again

`terminal_only` is simpler for linear workflows. `progressive` is better when the caller needs to react to each intermediate update.

---

## Quick start

## Installation

```bash
git clone <your-repo-url>
cd hitl-mcp
npm install
```

## Run in development

```bash
npm run dev
```

Default local bind:

- HTTP base URL: `http://0.0.0.0:4000`
- MCP base URL: `http://0.0.0.0:4000/mcp`
- HTTP API prefix: `/api/v1`

## Run with Docker

Build the image:

```bash
docker build -t hitl-mcp .
```

Run with in-memory storage:

```bash
docker run --rm -p 4000:4000 \
  -e MCP_URL=http://localhost:4000 \
  hitl-mcp
```

Run with Redis:

```bash
docker run --rm -p 4000:4000 \
  -e MCP_URL=http://localhost:4000 \
  -e HITL_STORAGE=redis \
  -e HITL_REDIS_URL=redis://host.docker.internal:6379 \
  hitl-mcp
```

## Run from source with environment variables

```bash
export MCP_URL=http://localhost:4000
npm run dev
```

## Minimal create request

```bash
curl -X POST "http://localhost:4000/api/v1/questions" \
  -H "Content-Type: application/json" \
  -H "x-agent-identity: agent/example" \
  -H "x-agent-session-id: session-123" \
  -d '{
    "title": "Release decision",
    "questions": [
      {
        "type": "single_choice",
        "title": "Deploy to production?",
        "options": [
          { "value": "yes", "label": "Yes" },
          { "value": "no", "label": "No" }
        ]
      }
    ]
  }'
```

---

## How interaction works

This section describes the intended runtime flow, regardless of whether the caller uses MCP tools or HTTP APIs.

### Sequence 1: standard ask -> wait -> answer -> complete

1. The Agent creates one or more questions in its caller scope.
2. A UI or backend fetches pending questions for the same caller scope.
3. A human answers one or more pending questions.
4. The Agent waits on the scope.
5. When the scope has no pending questions left, wait returns a terminal result.

### Sequence 2: partial submission

1. The Agent creates multiple questions.
2. The human answers only a subset.
3. The server persists those answers and keeps the remaining questions pending.
4. The Agent can keep waiting.
5. Additional submissions continue until the scope is complete.

### Sequence 3: progressive wait

1. `HITL_WAIT_MODE=progressive`
2. The Agent calls `hitl_wait`.
3. Any answer, skip, or cancellation in the scope wakes the waiter.
4. The wait result reports which `question_id`s changed.
5. The Agent decides whether to continue waiting or act on the intermediate update.

### Sequence 4: cancellation

1. A caller cancels one question or all pending questions in the scope.
2. The server updates scope state and notifies waiters.
3. If no pending questions remain, the scope becomes terminal.

### Scope semantics

Wait is always a **scope-level** operation.

This is deliberate:

- one Agent run may have multiple pending questions
- the Agent usually cares whether the workflow can continue
- scope-level wait avoids fragmented per-question synchronization logic

---

## MCP tools

`hitl-mcp` exposes the following MCP tools:

### `hitl_ask`

Creates one or more questions for the current caller scope.

Input shape:

```json
{
  "title": "Release decision",
  "description": "Human approval required before deploy",
  "ttl_seconds": 3600,
  "questions": [
    {
      "type": "boolean",
      "title": "Approve deployment?"
    }
  ]
}
```

Notes:

- `question_id` must not be provided by the caller
- the server generates `question_id`
- one request can create multiple questions

### `hitl_wait`

Waits on the current caller scope.

Typical response fields:

- `status`
- `is_terminal`
- `changed_question_ids`
- `pending_questions`
- `answered_question_ids`
- `skipped_question_ids`
- `cancelled_question_ids`
- `is_complete`

### `hitl_get_pending_questions`

Returns all pending questions in the current caller scope.

### `hitl_submit_answers`

Submits new answers and optional skips.

Input shape:

```json
{
  "answers": {
    "q_01JXYZ...": { "value": true }
  },
  "skipped_question_ids": ["q_01JABC..."],
  "idempotency_key": "idem-1"
}
```

Notes:

- `answers` may contain any subset of pending questions
- optional questions may be skipped explicitly
- required questions cannot be skipped
- submissions accumulate server-side

### `hitl_cancel_questions`

Cancels selected pending questions or all pending questions in the scope.

Input shape:

```json
{
  "question_ids": ["q_01JXYZ..."],
  "reason": "no longer needed"
}
```

Or:

```json
{
  "cancel_all": true
}
```

### `hitl_get_question`

Fetches one question by `question_id`.

---

## HTTP API

The HTTP control plane is primarily for operator UIs, backend services, and troubleshooting.

### Response envelope

All HTTP responses use the same envelope:

```json
{
  "request_id": "http-request-id",
  "success": true,
  "data": {},
  "error": null
}
```

On failure:

```json
{
  "request_id": "http-request-id",
  "success": false,
  "data": {},
  "error": {
    "code": "QUESTION_NOT_FOUND",
    "message": "question not found",
    "details": null
  }
}
```

### Headers and identity rules

For question APIs, the server requires a session header on every caller-scoped request:

- default session header: `x-agent-session-id`

Identity rules:

- send `x-agent-identity` on every caller-scoped request

Operationally:

- the server reads `agent_identity` directly from `x-agent-identity`

### `GET /api/v1/healthz`

Returns liveness status.

### `GET /api/v1/readyz`

Returns readiness status.

This is the correct probe for Redis-backed production deployments.

### `GET /api/v1/metrics`

Returns an in-process metrics snapshot.

### `POST /api/v1/questions`

Creates one or more questions for the current caller scope.

Request body:

```json
{
  "title": "Release decision",
  "description": "Human approval required before deploy",
  "ttl_seconds": 3600,
  "questions": [
    {
      "type": "single_choice",
      "title": "Deploy to production?",
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

Supported question payloads:

- `single_choice` with `options`
- `multi_choice` with `options`
- `text` with optional `text_constraints`
- `boolean`
- `range` with `range_constraints`

### `GET /api/v1/questions/pending`

Returns all pending questions for the current caller scope.

### `POST /api/v1/questions/answers`

Submits answered and skipped questions.

Request body:

```json
{
  "answers": {
    "q_01JXYZ...": { "value": "yes" }
  },
  "skipped_question_ids": ["q_01JABC..."],
  "idempotency_key": "idem-1"
}
```

Behavior:

- accepts partial progress
- persists cumulative scope state
- wakes scope waiters after successful submission

Typical error codes:

- `QUESTION_NOT_FOUND`
- `ANSWER_VALIDATION_FAILED`

### `POST /api/v1/questions/cancel`

Cancels pending questions in the current caller scope.

Request body:

```json
{
  "question_ids": ["q_01JXYZ..."],
  "reason": "no longer needed"
}
```

Or:

```json
{
  "cancel_all": true
}
```

### `GET /api/v1/questions/:question_id`

Fetches one question by `question_id`.

If the question does not exist, the server returns `404` with `QUESTION_NOT_FOUND`.

---

## Runtime configuration

## Configuration sources and precedence

Configuration is loaded in this order:

1. built-in defaults
2. `config/hitl-mcp.yaml`
3. `.env`
4. process environment variables

Later sources override earlier ones.

## Environment variables

The following environment variables are currently supported by the codebase.

| Variable | Default | Purpose | When to change |
| --- | --- | --- | --- |
| `PORT` | `4000` | Fallback HTTP port. Equivalent to `HITL_HTTP_PORT` when set. | Change when your runtime injects only `PORT` or when a platform requires a fixed port env. |
| `MCP_URL` | `http://0.0.0.0:4000` | Public base URL used by the MCP server metadata. | Change in any non-local deployment so MCP clients receive the reachable external URL. |
| `HITL_SERVER_NAME` | `hitl-mcp` | MCP server name metadata. | Change when embedding this server under another product identity. |
| `HITL_SERVER_VERSION` | `0.1.0` | MCP server version metadata. | Change when publishing a packaged build with an explicit runtime version. |
| `HITL_HTTP_HOST` | `0.0.0.0` | HTTP bind host. | Change only if you intentionally want loopback-only binding or a different interface. |
| `HITL_HTTP_PORT` | `4000` | Explicit HTTP port. Overrides the default port. | Change in local multi-service setups or production platforms with custom port mapping. |
| `HITL_HTTP_API_PREFIX` | `/api/v1` | Prefix for HTTP control-plane routes. | Change only if you need to mount the API behind a different path segment. |
| `HITL_STORAGE` | `memory` | Storage backend selection: `memory` or `redis`. | Set to `redis` for multi-process or durable deployments. |
| `HITL_REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL. | Required when `HITL_STORAGE=redis` outside local defaults. |
| `HITL_REDIS_PREFIX` | `hitl` | Redis key prefix. | Change when multiple environments share one Redis instance. |
| `HITL_TTL_SECONDS` | `604800` | Default TTL for newly created question sets. | Change to align pending-question retention with your business SLA. |
| `HITL_ANSWERED_RETENTION_SECONDS` | `2592000` | Retention window for answered state. | Change when auditability or storage pressure requires a different retention period. |
| `HITL_PENDING_MAX_WAIT_SECONDS` | `0` | Maximum duration for one wait call. `0` means no timeout limit. | Change when you need bounded waits for worker scheduling or request lifecycle control. |
| `HITL_WAIT_MODE` | `terminal_only` | Scope wait behavior: `terminal_only` or `progressive`. | Set to `progressive` when callers must react to each intermediate update. |
| `HITL_AGENT_SESSION_HEADER` | `x-agent-session-id` | Header name used to read `agent_session_id`. | Change when integrating with an existing gateway or client that uses another session header. |
| `HITL_CREATE_CONFLICT_POLICY` | `error` | Create conflict policy in config surface. | Keep at default. The current code validates and loads it, but it is not currently applied by request handlers. |
| `HITL_LOG_LEVEL` | `info` | Structured logging level: `debug`, `info`, `warn`, `error`. | Raise or lower verbosity to match debugging and production noise requirements. |
| `HITL_ENABLE_METRICS` | `true` | Enables metrics collection in config. | Leave enabled unless you are intentionally minimizing observability overhead. |

## YAML example

```yaml
http:
  host: 0.0.0.0
  port: 4000
  apiPrefix: /api/v1
storage:
  kind: redis
redis:
  url: redis://127.0.0.1:6379
  keyPrefix: hitl
ttl:
  defaultSeconds: 604800
  answeredRetentionSeconds: 2592000
pending:
  maxWaitSeconds: 0
  waitMode: terminal_only
agentIdentity:
  sessionHeader: x-agent-session-id
  createConflictPolicy: error
observability:
  logLevel: info
  enableMetrics: true
```

## Configuration recommendations

### Local development

- `HITL_STORAGE=memory`
- send `x-agent-identity` from your client or test harness
- keep `HITL_WAIT_MODE=terminal_only`

### Shared dev or staging

- `HITL_STORAGE=redis`
- set a real `MCP_URL`
- use a distinct `HITL_REDIS_PREFIX`
- ensure upstream callers always provide `x-agent-identity`

### Production

- `HITL_STORAGE=redis`
- set `MCP_URL` to the externally reachable URL
- wire readiness to `/api/v1/readyz`
- review TTL and retention values explicitly
- ensure upstream callers always provide `x-agent-identity`

---

## How it works internally

### Scope state machine

`hitl-mcp` maintains question progress at the caller-scope level.

Each state-changing operation updates a scope snapshot containing:

- pending questions
- answered question IDs
- skipped question IDs
- cancelled question IDs
- changed question IDs
- completion status

This snapshot is the source of truth for wait results.

### Waiter notification model

The server keeps an in-process waiter registry keyed by caller scope.

When answers or cancellations arrive:

1. storage is updated
2. a fresh scope snapshot is computed
3. the waiter for that scope is notified
4. `hitl_wait` resolves according to the configured wait mode

### Storage selection

Two storage modes exist:

- **memory**: simple, process-local, good for tests and local development
- **redis**: durable across processes and suitable for real deployments

If Redis is selected but unavailable during runtime initialization, the server falls back to in-memory storage and logs a warning.

That fallback is useful in local development, but production environments should treat it as a misconfiguration signal.

### Identity handling

For HTTP question APIs:

- session identity comes from `HITL_AGENT_SESSION_HEADER`
- caller identity comes from `x-agent-identity`

For MCP tool calls:

- the server injects caller scope into MCP tool state from request context
- the tool layer reads `agent_identity` and `agent_session_id` from that injected state

---

## Architecture

The runtime has five main layers.

### 1. Config layer

Loads and validates configuration from defaults, YAML, `.env`, and runtime environment variables.

### 2. Server layer

Builds the MCP server and the HTTP app, attaches middleware, and registers routes and tools.

### 3. Service layer

`HitlService` defines the operational behavior for:

- create
- list pending
- wait
- submit answers
- cancel
- fetch question

This is the main application boundary.

### 4. Storage layer

Provides repository implementations for:

- in-memory development and tests
- Redis-backed persistence

### 5. Observability layer

Provides:

- structured logs
- request IDs
- readiness checks
- metrics snapshots

### Request flow summary

For HTTP:

1. auth and caller context middleware resolve identity and session
2. route handler validates input and calls `HitlService`
3. repository updates state
4. response is wrapped in the standard envelope

For MCP:

1. MCP request context is inspected
2. caller scope is injected into tool state
3. tool handler delegates to `HitlService`
4. tool output reflects the latest scope state

---

## Operations

## Health and readiness

- Liveness: `GET /api/v1/healthz`
- Readiness: `GET /api/v1/readyz`
- Metrics: `GET /api/v1/metrics`

Use readiness, not liveness, to guard Redis-backed production traffic.

## Logging

The server emits structured request and error logs.

Set `HITL_LOG_LEVEL=debug` when troubleshooting request flow or repository behavior.

## Metrics

Metrics are exposed as a JSON snapshot through `/api/v1/metrics`.

The current implementation tracks operational signals such as wait duration and pending counts.

## Common deployment checks

Before declaring a deployment healthy, verify:

1. `MCP_URL` matches the externally reachable URL.
2. The exposed HTTP port matches your runtime or ingress mapping.
3. `HITL_STORAGE=redis` is paired with a reachable Redis instance.
4. Upstream callers send `x-agent-identity` and the configured session header.
5. `/api/v1/healthz`, `/api/v1/readyz`, and `/api/v1/metrics` all respond as expected.

---

## Project structure

```text
.
├── config/                     # YAML configuration examples
├── docs/
│   ├── api/                    # MCP tool and HTTP API reference docs
│   └── runbooks/               # Operational runbooks
├── src/
│   ├── config/                 # Config schema, defaults, loaders
│   ├── core/                   # HitlService application logic
│   ├── domain/                 # Domain types, schemas, validators
│   ├── http/                   # Hono routes, middleware, response helpers
│   ├── mcp/                    # MCP tool registration and caller-scope helpers
│   ├── observability/          # Logging and metrics
│   ├── state/                  # Waiter and state-machine helpers
│   └── storage/                # In-memory and Redis repositories
├── tests/                      # Unit and integration coverage
├── Dockerfile                  # Production-oriented container build
└── index.ts                    # Runtime entrypoint
```

## Related docs

- [MCP tools](docs/api/mcp-tools.md)
- [HTTP API](docs/api/http-openapi.md)
- [Production runbook](docs/runbooks/production.md)
- [HITL skill](skills/hitl/SKILL.md)
