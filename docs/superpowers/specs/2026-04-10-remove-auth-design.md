# Remove API Key Auth Design

## Summary

Remove all authentication logic from the project, especially `x-api-key` handling in both HTTP and MCP entrypoints, while preserving caller isolation by continuing to scope all mutable state by `(agent_identity, agent_session_id)`.

After this change:

- `agent_identity` is always provided explicitly by the caller via `x-agent-identity`
- `agent_session_id` is always provided via the configured session header, defaulting to `x-agent-session-id`
- HTTP and MCP share the same caller-context extraction model
- No runtime config, middleware, docs, or tests refer to `x-api-key` or auth mode

## Goals

- Remove `x-api-key` authentication from HTTP routes and MCP routes
- Remove auth-related configuration and code paths
- Preserve existing session-level and caller-level isolation semantics
- Keep repository and service scoping unchanged
- Update tests and documentation to match the new contract

## Non-Goals

- Changing repository storage structure or key format
- Relaxing caller isolation requirements
- Adding fallback anonymous identities
- Changing tool names, HTTP route shapes, or question lifecycle semantics

## Current State

The current runtime derives caller scope from request context:

- `agent_identity` comes from either API key auth or `x-agent-identity`
- `agent_session_id` comes from `HITL_AGENT_SESSION_HEADER`
- MCP tools bridge HTTP request context into MCP middleware state
- Repository state is scoped by `(agent_identity, agent_session_id)`

The auth-specific pieces are concentrated in:

- `src/http/middleware/auth.ts`
- `src/server/create-server.ts`
- config schema/default/env loading for `security.apiKey` and `agentIdentity.authMode`
- integration and unit tests covering optional and required API key behavior
- README, OpenAPI, runbook, and config examples

## Proposed Design

### 1. Unified Caller Context Contract

All external entrypoints use the same required headers:

- `x-agent-identity`
- `x-agent-session-id` or whatever header is configured by `agentIdentity.sessionHeader`

Both headers are required for HTTP question routes and MCP tool calls.

Error behavior:

- Missing identity returns `AGENT_IDENTITY_REQUIRED`
- Missing session id returns `AGENT_SESSION_ID_REQUIRED`

This keeps the trust model explicit: the server no longer authenticates a caller, it only requires caller-provided scope identifiers.

### 2. Request Context Middleware Simplification

`requestContextMiddleware` becomes the single place that extracts caller scope.

It will:

- read `x-agent-identity` directly from the request
- read the configured session header directly from the request
- write both values into Hono request context as `agentIdentity` and `agentSessionId`

It will no longer accept a `resolveAgentIdentity` callback, because there is no auth-derived principal path left to resolve.

### 3. HTTP Runtime Composition

`create-server.ts` will stop mounting any auth middleware.

Instead:

- all question HTTP routes keep using request-context middleware
- `/mcp*` also uses request-context middleware so MCP requests receive the same context contract

This removes the previous split between:

- auth middleware
- request-context middleware
- optional no-auth identity fallback

### 4. MCP Caller Scope Bridge

`src/mcp/caller-scope.ts` remains conceptually the same.

It will continue to:

- read `agentIdentity` and `agentSessionId` from request context
- copy them into MCP middleware state
- let tools read caller scope from MCP context

No repository or service-level scope behavior changes. The isolation key remains `(agent_identity, agent_session_id)`.

### 5. Config Simplification

Remove these config surfaces:

- `security.apiKey`
- `agentIdentity.authMode`
- `HITL_API_KEY`
- `HITL_AGENT_AUTH_MODE`

Keep:

- `agentIdentity.sessionHeader`
- `agentIdentity.createConflictPolicy`

This avoids dead config that appears supported but no longer affects runtime behavior.

### 6. Test Strategy

Follow TDD for implementation changes:

1. Update tests to express the new required caller context contract
2. Run focused tests and confirm they fail for the expected reason
3. Implement the minimal production changes
4. Re-run focused tests, then broader verification

Tests to update:

- request-context unit tests
- MCP caller-scope bridge tests if assumptions changed
- security/auth integration tests, rewritten around required headers instead of API keys
- config loader tests that currently assert auth fields
- any HTTP integration tests still sending `x-api-key`

Tests to preserve:

- all scope isolation tests that validate `(agent_identity, agent_session_id)` semantics

## Affected Areas

### Code

- `src/http/middleware/auth.ts`
- `src/http/middleware/request-context.ts`
- `src/server/create-server.ts`
- `src/config/types.ts`
- `src/config/defaults.ts`
- `src/config/load-config.ts`
- `src/http/context-variables.d.ts` if type comments or names need updates

### Tests

- `tests/integration/security-auth.test.ts`
- `tests/unit/request-context.test.ts`
- `tests/unit/config-loader-priority.test.ts`
- any integration tests that currently set `HITL_API_KEY` or `x-api-key`

### Docs

- `README.md`
- `README-zh.md`
- `docs/api/http-openapi.md`
- `docs/api/mcp-tools.md`
- `docs/runbooks/production.md`
- `config/hitl-mcp.yaml.example`

## Behavioral Impact

### Before

- Shared deployments could require `x-api-key`
- Local mode could omit auth and send `x-agent-identity`
- Runtime behavior depended on config

### After

- All deployments use the same caller-scope headers
- Clients must always send `x-agent-identity`
- Clients must always send the session header
- There is no authentication gate in the service

## Risks And Mitigations

### Risk: Existing clients still send `x-api-key`

Impact:

- callers will fail with `AGENT_IDENTITY_REQUIRED`

Mitigation:

- update README and examples to show the new required headers everywhere
- update integration tests to prevent accidental regression back to auth-based examples

### Risk: Config files still contain old auth fields

Impact:

- config parsing failures or misleading examples

Mitigation:

- remove fields from schema, defaults, env mapping, and examples together
- update config loader tests to assert the new supported fields only

### Risk: MCP requests do not receive context on `/mcp*`

Impact:

- tools fail because state injection cannot find caller scope

Mitigation:

- mount request-context middleware on `/mcp*`
- keep bridge tests that validate request-context to MCP-state propagation

## Verification Plan

- Run focused unit and integration tests for request context, config, and auth replacement behavior
- Run MCP registration / MCP caller scope tests to ensure request context still bridges into tool execution
- Run a broader test pass for the affected HTTP and MCP integration suites

## Acceptance Criteria

- No production code path reads `x-api-key`
- No config schema or docs expose API key auth knobs
- HTTP question routes require `x-agent-identity` and session header
- MCP routes require the same caller-context headers
- Repository isolation remains keyed by `(agent_identity, agent_session_id)`
- Updated tests cover the new contract and pass
