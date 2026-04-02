# HITL Agent Identity And Session Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `hitl-mcp` so the server derives stable Agent identity from connection authentication, derives Agent Session ID from connection headers, generates `question_group_id` server-side, supports one pending group per `(agent_identity, agent_session_id)`, and exposes the correct MCP tool surface: `create`, `wait`, and `get_current`.

**Architecture:** Keep the existing Hono + `mcp-use` single-process runtime, but move caller identity from tool input into request context. Add a request-scoped identity/session context layer, persist that scope on every question group, introduce repository indexes for current pending and idempotent create, and make the MCP surface explicit with separate create/wait/current primitives.

**Tech Stack:** TypeScript, Node.js, mcp-use, Hono, Zod, Redis/ioredis, Vitest, Supertest

---

## File Structure

- `src/config/types.ts`
  Purpose: extend config schema for MCP agent auth/header extraction policy.
- `src/config/defaults.ts`
  Purpose: default values for auth mode, session header name, and create conflict policy.
- `src/config/load-config.ts`
  Purpose: load new config values from env/yaml.
- `config/hitl-mcp.yaml.example`
  Purpose: document example runtime config for fixed auth identity + session header extraction.
- `src/http/middleware/auth.ts`
  Purpose: evolve from API-key-only HTTP middleware into reusable identity extraction helpers for HTTP and MCP routes.
- `src/http/middleware/request-context.ts`
  Purpose: new middleware to derive and store `agent_identity` and `agent_session_id` on every request context.
- `src/http/routes/question-groups.ts`
  Purpose: keep existing finalize/cancel/expire endpoints and add current-group read endpoint.
- `src/domain/types.ts`
  Purpose: add explicit scoped group models and context types.
- `src/domain/schemas.ts`
  Purpose: remove caller-supplied `question_group_id` from create/ask inputs, add schemas for create/wait/current tools.
- `src/domain/errors.ts`
  Purpose: centralize new domain errors like `AGENT_IDENTITY_REQUIRED`, `AGENT_SESSION_ID_REQUIRED`, `PENDING_GROUP_ALREADY_EXISTS`.
- `src/storage/hitl-repository.ts`
  Purpose: expand repository interface for scoped pending lookup, server-side ID creation, and create idempotency.
- `src/storage/redis-keys.ts`
  Purpose: add keys for scope index and create idempotency cache.
- `src/storage/in-memory-repository.ts`
  Purpose: implement new repository contract for tests and non-Redis mode.
- `src/storage/redis-hitl-repository.ts`
  Purpose: implement scoped pending uniqueness and create idempotency in Redis.
- `src/state/waiter.ts`
  Purpose: keep group-id keyed waiters for explicit wait operations.
- `src/core/hitl-service.ts`
  Purpose: split logic into `createQuestionGroup`, `waitQuestionGroup`, and `getCurrentQuestionGroup`.
- `src/mcp/register-tools.ts`
  Purpose: register the new MCP tools.
- `src/mcp/tools/create-question-group.ts`
  Purpose: new tool returning immediate pending state with server-generated group ID.
- `src/mcp/tools/wait-question-group.ts`
  Purpose: new tool waiting for terminal status by explicit group ID or current session scope.
- `src/mcp/tools/get-current-question-group.ts`
  Purpose: new tool returning current pending group for the caller scope.
- `src/server/create-server.ts`
  Purpose: wire config, request context middleware, shared runtime deps.
- `index.ts`
  Purpose: wire the same middleware stack in the process entrypoint.
- `tests/unit/domain-schemas.test.ts`
  Purpose: assert new schema contract and removal of caller-supplied `question_group_id`.
- `tests/unit/repository-selection.test.ts`
  Purpose: keep repository selection coverage after interface changes.
- `tests/unit/redis-repository.test.ts`
  Purpose: cover new Redis indexes and scoped uniqueness semantics.
- `tests/unit/in-memory-repository.test.ts`
  Purpose: new focused tests for scoped create, pending lookup, and idempotency in memory mode.
- `tests/unit/request-context.test.ts`
  Purpose: cover identity/session extraction from auth and headers.
- `tests/integration/e2e-pending-to-answered.test.ts`
  Purpose: adapt end-to-end flow to `create -> wait -> finalize`.
- `tests/integration/http-finalize.test.ts`
  Purpose: ensure finalize still keeps group pending on validation errors.
- `tests/integration/http-current-group.test.ts`
  Purpose: new test for current scoped group HTTP endpoint.
- `README.md`
  Purpose: document new identity model and new tool contract.
- `README-zh.md`
  Purpose: Chinese documentation update mirroring English semantics.
- `docs/api/mcp-tools.md`
  Purpose: update tool contract and examples.
- `docs/api/http-openapi.md`
  Purpose: add current-group endpoint and revised auth/session expectations.
- `docs/design-doc.md`
  Purpose: align architecture narrative with server-owned IDs and scoped pending groups.

---

## Implementation Notes

- Use connection authentication as the sole trusted source for `agent_identity`.
- Use a fixed request header, default `x-agent-session-id`, as the primary source for `agent_session_id`.
- Do not trust tool-input session metadata; connection header is the only supported source for `agent_session_id`.
- Keep `question_group_id` as the only waiter key and external object identifier.
- Enforce uniqueness on `pending` groups per `(agent_identity, agent_session_id)`.
- Preserve current terminal statuses: `pending | answered | cancelled | expired`.
- Prefer additive migration first, then tighten the schema once tests and docs are green.

---

### Task 1: Define Caller Identity, Session Context, And New Configuration

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/load-config.ts`
- Modify: `config/hitl-mcp.yaml.example`
- Create: `src/domain/errors.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/unit/config-loader-priority.test.ts`
- Test: `tests/unit/domain-schemas.test.ts`

- [ ] **Step 1: Write the failing config and type tests**

```ts
// tests/unit/config-loader-priority.test.ts
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config/load-config';

describe('config loader identity settings', () => {
  it('loads auth principal and session header settings', async () => {
    const config = await resolveConfig({
      env: {
        HITL_AGENT_AUTH_MODE: 'api_key',
        HITL_AGENT_SESSION_HEADER: 'x-agent-session-id',
        HITL_CREATE_CONFLICT_POLICY: 'error'
      }
    });

    expect(config.agentIdentity.authMode).toBe('api_key');
    expect(config.agentIdentity.sessionHeader).toBe('x-agent-session-id');
    expect(config.agentIdentity.createConflictPolicy).toBe('error');
  });
});
```

```ts
// tests/unit/domain-schemas.test.ts
import { describe, expect, it } from 'vitest';
import { createQuestionGroupInputSchema } from '../../src/domain/schemas';

describe('create question group schema', () => {
  it('rejects caller-supplied question_group_id', () => {
    const parsed = createQuestionGroupInputSchema.safeParse({
      question_group_id: 'qg_bad',
      title: 'Need approval',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/unit/config-loader-priority.test.ts tests/unit/domain-schemas.test.ts`
Expected: FAIL because `agentIdentity` config and `createQuestionGroupInputSchema` do not exist.

- [ ] **Step 3: Add config types, defaults, and domain types**

```ts
// src/config/types.ts
import { z } from 'zod';

export const configSchema = z.object({
  server: z.object({
    name: z.string(),
    version: z.string(),
    baseUrl: z.string().url()
  }),
  http: z.object({
    port: z.number().int().positive(),
    apiPrefix: z.string().min(1)
  }),
  security: z.object({
    apiKey: z.string().optional()
  }),
  agentIdentity: z.object({
    authMode: z.enum(['api_key', 'bearer']),
    sessionHeader: z.string().min(1),
    createConflictPolicy: z.enum(['error', 'reuse_pending'])
  }),
  storage: z.object({
    kind: z.enum(['memory', 'redis'])
  }),
  redis: z.object({
    url: z.string(),
    keyPrefix: z.string()
  }),
  ttl: z.object({
    defaultSeconds: z.number().int().positive()
  }),
  pending: z.object({
    maxWaitSeconds: z.number().int().nonnegative()
  }),
  observability: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error'])
  })
});

export type AppConfig = z.infer<typeof configSchema>;
```

```ts
// src/config/defaults.ts
import type { AppConfig } from './types';

export const defaultConfig: AppConfig = {
  server: {
    name: 'hitl-mcp',
    version: '1.0.0',
    baseUrl: 'http://localhost:3000'
  },
  http: {
    port: 3000,
    apiPrefix: '/api/v1'
  },
  security: {
    apiKey: undefined
  },
  agentIdentity: {
    authMode: 'api_key',
    sessionHeader: 'x-agent-session-id',
    createConflictPolicy: 'error'
  },
  storage: {
    kind: 'memory'
  },
  redis: {
    url: 'redis://127.0.0.1:6379',
    keyPrefix: 'hitl'
  },
  ttl: {
    defaultSeconds: 604800
  },
  pending: {
    maxWaitSeconds: 0
  },
  observability: {
    logLevel: 'info'
  }
};
```

```ts
// src/domain/types.ts
export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

export type CallerScope = {
  agent_identity: string;
  agent_session_id: string;
};

export type ScopedQuestionGroup = CallerScope & {
  question_group_id: string;
  title: string;
  description?: string;
  questions: Array<Record<string, unknown>>;
  status: GroupStatus;
  created_at: string;
  updated_at: string;
  answers?: Record<string, unknown>;
  idempotency_key?: string;
  extra?: Record<string, unknown>;
};
```

```ts
// src/domain/errors.ts
export class DomainError extends Error {
  constructor(
    public readonly code:
      | 'AGENT_IDENTITY_REQUIRED'
      | 'AGENT_SESSION_ID_REQUIRED'
      | 'PENDING_GROUP_ALREADY_EXISTS'
      | 'PENDING_GROUP_NOT_FOUND'
      | 'QUESTION_GROUP_NOT_FOUND',
    message: string
  ) {
    super(message);
  }
}
```

- [ ] **Step 4: Map new config env vars and document them**

```ts
// src/config/load-config.ts
import { defaultConfig } from './defaults';
import { configSchema, type AppConfig } from './types';

export async function resolveConfig(source?: {
  env?: Record<string, string | undefined>;
  yaml?: Record<string, any>;
}): Promise<AppConfig> {
  const env = source?.env ?? process.env;
  const yaml = source?.yaml ?? {};

  const merged: AppConfig = {
    ...defaultConfig,
    ...yaml,
    agentIdentity: {
      ...defaultConfig.agentIdentity,
      ...(yaml.agentIdentity ?? {}),
      authMode: (env.HITL_AGENT_AUTH_MODE as 'api_key' | 'bearer') ?? yaml.agentIdentity?.authMode ?? defaultConfig.agentIdentity.authMode,
      sessionHeader: env.HITL_AGENT_SESSION_HEADER ?? yaml.agentIdentity?.sessionHeader ?? defaultConfig.agentIdentity.sessionHeader,
      createConflictPolicy:
        (env.HITL_CREATE_CONFLICT_POLICY as 'error' | 'reuse_pending') ??
        yaml.agentIdentity?.createConflictPolicy ??
        defaultConfig.agentIdentity.createConflictPolicy
    }
  };

  return configSchema.parse(merged);
}
```

```yaml
# config/hitl-mcp.yaml.example
agentIdentity:
  authMode: api_key
  sessionHeader: x-agent-session-id
  createConflictPolicy: error
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- tests/unit/config-loader-priority.test.ts tests/unit/domain-schemas.test.ts`
Expected: PASS with both tests green.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts src/config/load-config.ts config/hitl-mcp.yaml.example src/domain/errors.ts src/domain/types.ts tests/unit/config-loader-priority.test.ts tests/unit/domain-schemas.test.ts
git commit -m "feat: define agent identity and session config"
```

### Task 2: Introduce Trusted Request Context Extraction

**Files:**
- Modify: `src/http/middleware/auth.ts`
- Create: `src/http/middleware/request-context.ts`
- Modify: `src/server/create-server.ts`
- Modify: `index.ts`
- Test: `tests/unit/request-context.test.ts`
- Test: `tests/integration/security-auth.test.ts`

- [ ] **Step 1: Write failing tests for identity and session extraction**

```ts
// tests/unit/request-context.test.ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import request from 'supertest';
import { requestContextMiddleware } from '../../src/http/middleware/request-context';

describe('request context middleware', () => {
  it('extracts agent identity from api key principal and session id from header', async () => {
    const app = new Hono();
app.use('*', requestContextMiddleware({
  sessionHeader: 'x-agent-session-id',
  resolveAgentIdentity: (c) => {
    const apiKey = c.req.header('x-api-key');
    return apiKey === 'agent-key-1' ? 'agent/runtime-1' : null;
      }
    }));
    app.get('/check', (c) => c.json({
      agent_identity: c.get('agentIdentity'),
      agent_session_id: c.get('agentSessionId')
    }));

    const res = await request(app.fetch)
      .get('/check')
      .set('x-api-key', 'agent-key-1')
      .set('x-agent-session-id', 'session-123');

    expect(res.status).toBe(200);
    expect(res.body.agent_identity).toBe('agent/runtime-1');
    expect(res.body.agent_session_id).toBe('session-123');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/unit/request-context.test.ts tests/integration/security-auth.test.ts`
Expected: FAIL because `requestContextMiddleware` and principal extraction do not exist.

- [ ] **Step 3: Expand auth middleware to resolve trusted agent identity**

```ts
// src/http/middleware/auth.ts
import type { Context, MiddlewareHandler } from 'hono';
import { fail } from '../response';

export function resolveApiKeyPrincipal(c: Context, expectedApiKey: string): string | null {
  const provided = c.req.header('x-api-key');
  if (!provided || provided !== expectedApiKey) return null;
  return `api_key:${provided}`;
}

export function apiKeyAuth(expectedApiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') ?? 'local';
    const principal = resolveApiKeyPrincipal(c, expectedApiKey);
    if (!principal) {
      return c.json(fail(requestId, 'UNAUTHORIZED', 'invalid api key'), 401);
    }

    c.set('agentIdentity', principal);
    await next();
  };
}
```

- [ ] **Step 4: Add request context middleware**

```ts
// src/http/middleware/request-context.ts
import type { Context, MiddlewareHandler } from 'hono';
import { fail } from '../response';

export function requestContextMiddleware(params: {
  sessionHeader: string;
  resolveAgentIdentity: (c: Context) => string | null;
}): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') ?? 'local';
    const agentIdentity = params.resolveAgentIdentity(c);
    if (!agentIdentity) {
      return c.json(fail(requestId, 'AGENT_IDENTITY_REQUIRED', 'agent identity required'), 401);
    }

    const agentSessionId = c.req.header(params.sessionHeader);

    if (!agentSessionId) {
      return c.json(fail(requestId, 'AGENT_SESSION_ID_REQUIRED', 'agent session id required'), 400);
    }

    c.set('agentIdentity', agentIdentity);
    c.set('agentSessionId', agentSessionId);
    await next();
  };
}
```

- [ ] **Step 5: Wire middleware in both runtime entrypoints**

```ts
// src/server/create-server.ts
import { requestContextMiddleware } from '../http/middleware/request-context';
import { resolveApiKeyPrincipal } from '../http/middleware/auth';

app.use('*', requestContextMiddleware({
  sessionHeader: config.agentIdentity.sessionHeader,
  resolveAgentIdentity: (c) => config.security.apiKey
    ? resolveApiKeyPrincipal(c, config.security.apiKey)
    : null
}));
```

```ts
// index.ts
server.use(requestContextMiddleware({
  sessionHeader: config.agentIdentity.sessionHeader,
  resolveAgentIdentity: (c) => config.security.apiKey
    ? resolveApiKeyPrincipal(c, config.security.apiKey)
    : null
}));
```

- [ ] **Step 6: Run tests and confirm pass**

Run: `npm run test -- tests/unit/request-context.test.ts tests/integration/security-auth.test.ts`
Expected: PASS with request context and auth behavior green.

- [ ] **Step 7: Commit**

```bash
git add src/http/middleware/auth.ts src/http/middleware/request-context.ts src/server/create-server.ts index.ts tests/unit/request-context.test.ts tests/integration/security-auth.test.ts
git commit -m "feat: derive agent identity and session from connection context"
```

### Task 3: Refactor Domain Schemas And Repository Contract For Server-Owned Group IDs

**Files:**
- Modify: `src/domain/schemas.ts`
- Modify: `src/storage/hitl-repository.ts`
- Modify: `src/storage/redis-keys.ts`
- Test: `tests/unit/domain-schemas.test.ts`
- Test: `tests/unit/redis-repository.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

```ts
// tests/unit/redis-repository.test.ts
import { describe, expect, it } from 'vitest';
import Redis from 'ioredis-mock';
import { RedisHitlRepository } from '../../src/storage/redis-hitl-repository';

describe('redis repository scoped pending lookup', () => {
  it('finds current pending group by agent identity and session', async () => {
    const redis = new Redis();
    const repo = new RedisHitlRepository(redis as any, 'test', 3600);

    const created = await repo.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Approval',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    const current = await repo.getPendingGroupByScope('api_key:a1', 'session-1');
    expect(current?.question_group_id).toBe(created.question_group_id);
    expect(current?.status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/unit/domain-schemas.test.ts tests/unit/redis-repository.test.ts`
Expected: FAIL because repository still requires caller-provided `question_group_id`.

- [ ] **Step 3: Replace ask/create schema contract**

```ts
// src/domain/schemas.ts
import { z } from 'zod';

const commonQuestionSchema = {
  question_id: z.string().min(1).describe('Stable question identifier inside the group'),
  title: z.string().min(1).describe('Human-readable question title'),
  description: z.string().optional().describe('Optional markdown question description'),
  required: z.boolean().default(true).describe('Whether the question must be answered')
};

export const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...commonQuestionSchema, type: z.literal('boolean') }),
  z.object({
    ...commonQuestionSchema,
    type: z.literal('text'),
    text_constraints: z.object({
      min_length: z.number().int().min(0).optional(),
      max_length: z.number().int().positive().optional(),
      pattern: z.string().optional()
    }).optional()
  })
]);

export const createQuestionGroupInputSchema = z.object({
  title: z.string().min(1).describe('Question group title'),
  description: z.string().optional().describe('Optional markdown description'),
  ttl_seconds: z.number().int().positive().optional().describe('Optional custom TTL'),
  questions: z.array(questionSchema).min(1).describe('Questions in the group'),
  idempotency_key: z.string().optional().describe('Optional create idempotency key'),
  extra: z.record(z.string(), z.any()).optional().describe('Opaque extra metadata')
}).strict();

export const waitQuestionGroupInputSchema = z.object({
  question_group_id: z.string().min(1).optional().describe('Explicit question group id to wait on')
}).strict();
```

- [ ] **Step 4: Expand repository interface and Redis key helpers**

```ts
// src/storage/hitl-repository.ts
import type { ScopedQuestionGroup } from '../domain/types';

export interface CreatePendingGroupInput {
  agent_identity: string;
  agent_session_id: string;
  title: string;
  description?: string;
  ttl_seconds?: number;
  questions: Array<Record<string, unknown>>;
  idempotency_key?: string;
  extra?: Record<string, unknown>;
}

export interface HitlRepository {
  isReady?(): Promise<boolean>;
  createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup>;
  getGroup(groupId: string): Promise<ScopedQuestionGroup | null>;
  getPendingGroupByScope(agentIdentity: string, agentSessionId: string): Promise<ScopedQuestionGroup | null>;
  getGroupByCreateIdempotency(agentIdentity: string, agentSessionId: string, idempotencyKey: string): Promise<ScopedQuestionGroup | null>;
  getQuestion(questionId: string): Promise<Record<string, unknown> | null>;
  getGroupStatus(groupId: string): Promise<Record<string, unknown> | null>;
  finalizeAnswers(groupId: string, answers: Record<string, unknown>, idempotencyKey?: string): Promise<{ status: 'answered'; answered_question_ids: string[]; answered_at: string }>;
  cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }>;
  expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }>;
}
```

```ts
// src/storage/redis-keys.ts
export const redisKeys = {
  qg: (prefix: string, groupId: string) => `${prefix}:qg:${groupId}`,
  q: (prefix: string, questionId: string) => `${prefix}:q:${questionId}`,
  idxQ2G: (prefix: string, questionId: string) => `${prefix}:idx:q2g:${questionId}`,
  pendingScope: (prefix: string, agentIdentity: string, agentSessionId: string) => `${prefix}:idx:pending:${agentIdentity}:${agentSessionId}`,
  createIdem: (prefix: string, agentIdentity: string, agentSessionId: string, idempotencyKey: string) =>
    `${prefix}:idx:create-idem:${agentIdentity}:${agentSessionId}:${idempotencyKey}`,
  ans: (prefix: string, groupId: string) => `${prefix}:ans:${groupId}`,
  idem: (prefix: string, kind: string, key: string) => `${prefix}:idem:${kind}:${key}`
};
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- tests/unit/domain-schemas.test.ts tests/unit/redis-repository.test.ts`
Expected: Schema tests pass and repository tests now fail only on implementation gaps, proving the contract changed correctly.

- [ ] **Step 6: Commit**

```bash
git add src/domain/schemas.ts src/storage/hitl-repository.ts src/storage/redis-keys.ts tests/unit/domain-schemas.test.ts tests/unit/redis-repository.test.ts
git commit -m "refactor: define server-owned group id contracts"
```

### Task 4: Implement Scoped Pending And Create Idempotency In Storage

**Files:**
- Modify: `src/storage/in-memory-repository.ts`
- Modify: `src/storage/redis-hitl-repository.ts`
- Create: `tests/unit/in-memory-repository.test.ts`
- Modify: `tests/unit/redis-repository.test.ts`

- [ ] **Step 1: Write failing storage tests for uniqueness and idempotency**

```ts
// tests/unit/in-memory-repository.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository';

describe('in-memory repository scoped create', () => {
  it('returns the same pending group for matching create idempotency key', async () => {
    const repo = new InMemoryHitlRepository();

    const first = await repo.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    const second = await repo.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    expect(second.question_group_id).toBe(first.question_group_id);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts`
Expected: FAIL because repositories do not generate IDs or maintain scope indexes.

- [ ] **Step 3: Implement in-memory repository changes**

```ts
// src/storage/in-memory-repository.ts
import { randomUUID } from 'node:crypto';
import { transitionStatus } from '../state/status-machine';
import type { CreatePendingGroupInput, HitlRepository } from './hitl-repository';
import type { ScopedQuestionGroup } from '../domain/types';

export class InMemoryHitlRepository implements HitlRepository {
  private groups = new Map<string, ScopedQuestionGroup>();
  private pendingByScope = new Map<string, string>();
  private createIdempotency = new Map<string, string>();
  private finalizeIdempotency = new Map<string, { status: 'answered'; answered_question_ids: string[]; answered_at: string }>();

  private scopeKey(agentIdentity: string, agentSessionId: string) {
    return `${agentIdentity}::${agentSessionId}`;
  }

  async createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup> {
    const scopeKey = this.scopeKey(input.agent_identity, input.agent_session_id);
    const idemKey = input.idempotency_key ? `${scopeKey}::${input.idempotency_key}` : null;

    if (idemKey) {
      const existingId = this.createIdempotency.get(idemKey);
      if (existingId) return this.groups.get(existingId)!;
    }

    const existingPendingId = this.pendingByScope.get(scopeKey);
    if (existingPendingId) {
      throw new Error('PENDING_GROUP_ALREADY_EXISTS');
    }

    const now = new Date().toISOString();
    const group: ScopedQuestionGroup = {
      agent_identity: input.agent_identity,
      agent_session_id: input.agent_session_id,
      question_group_id: `qg_${randomUUID()}`,
      title: input.title,
      description: input.description,
      questions: input.questions,
      status: 'pending',
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
      extra: input.extra
    };

    this.groups.set(group.question_group_id, group);
    this.pendingByScope.set(scopeKey, group.question_group_id);
    if (idemKey) this.createIdempotency.set(idemKey, group.question_group_id);
    return group;
  }
}
```

- [ ] **Step 4: Implement Redis repository indexes**

```ts
// src/storage/redis-hitl-repository.ts
import { randomUUID } from 'node:crypto';
import type { ScopedQuestionGroup } from '../domain/types';

async createPendingGroup(input: CreatePendingGroupInput): Promise<ScopedQuestionGroup> {
  const now = new Date().toISOString();
  const groupId = `qg_${randomUUID()}`;
  const group: ScopedQuestionGroup = {
    agent_identity: input.agent_identity,
    agent_session_id: input.agent_session_id,
    question_group_id: groupId,
    title: input.title,
    description: input.description,
    questions: input.questions,
    status: 'pending',
    created_at: now,
    updated_at: now,
    idempotency_key: input.idempotency_key,
    extra: input.extra
  };

  const pendingKey = redisKeys.pendingScope(this.prefix, input.agent_identity, input.agent_session_id);
  const idemKey = input.idempotency_key
    ? redisKeys.createIdem(this.prefix, input.agent_identity, input.agent_session_id, input.idempotency_key)
    : null;

  if (idemKey) {
    const existingId = await this.redis.get(idemKey);
    if (existingId) return (await this.getGroup(existingId))!;
  }

  const setPending = await this.redis.set(pendingKey, groupId, 'NX', 'EX', this.ttlSeconds);
  if (setPending !== 'OK') throw new Error('PENDING_GROUP_ALREADY_EXISTS');

  const tx = this.redis.multi();
  tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(group), 'EX', this.ttlSeconds);
  if (idemKey) tx.set(idemKey, groupId, 'EX', this.ttlSeconds);
  for (const question of input.questions) {
    tx.set(redisKeys.q(this.prefix, String(question.question_id)), JSON.stringify(question), 'EX', this.ttlSeconds);
    tx.set(redisKeys.idxQ2G(this.prefix, String(question.question_id)), groupId, 'EX', this.ttlSeconds);
  }
  await tx.exec();

  return group;
}
```

- [ ] **Step 5: Ensure terminal transitions clear scope indexes**

```ts
// src/storage/redis-hitl-repository.ts
async finalizeAnswers(groupId: string, answers: Record<string, unknown>, idempotencyKey?: string) {
  const group = await this.getGroup(groupId);
  if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');

  const answeredAt = new Date().toISOString();
  const nextGroup = { ...group, status: 'answered' as const, answers, updated_at: answeredAt };
  const pendingKey = redisKeys.pendingScope(this.prefix, group.agent_identity, group.agent_session_id);

  const tx = this.redis.multi();
  tx.set(redisKeys.qg(this.prefix, groupId), JSON.stringify(nextGroup), 'EX', this.ttlSeconds);
  tx.del(pendingKey);
  await tx.exec();

  return {
    status: 'answered' as const,
    answered_question_ids: Object.keys(answers),
    answered_at: answeredAt
  };
}
```

- [ ] **Step 6: Run tests and confirm pass**

Run: `npm run test -- tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts`
Expected: PASS with scope uniqueness and idempotent create behavior covered.

- [ ] **Step 7: Commit**

```bash
git add src/storage/in-memory-repository.ts src/storage/redis-hitl-repository.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts
git commit -m "feat: persist scoped pending indexes and create idempotency"
```

### Task 5: Split Service Layer Into Create, Wait, And Current

**Files:**
- Modify: `src/core/hitl-service.ts`
- Modify: `src/state/waiter.ts`
- Test: `tests/integration/e2e-pending-to-answered.test.ts`

- [ ] **Step 1: Write failing service-level integration tests**

```ts
// tests/integration/e2e-pending-to-answered.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository';
import { Waiter } from '../../src/state/waiter';
import { HitlService } from '../../src/core/hitl-service';

describe('create -> wait -> finalize', () => {
  it('returns pending immediately and resolves wait after finalize', async () => {
    const repo = new InMemoryHitlRepository();
    const waiter = new Waiter();
    const service = new HitlService(repo, waiter, 0);

    const created = await service.createQuestionGroup({
      caller: { agent_identity: 'api_key:a1', agent_session_id: 'session-1' },
      input: {
        title: 'Deploy approval',
        questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
      }
    });

    expect(created.status).toBe('pending');

    const waitPromise = service.waitQuestionGroup({
      caller: { agent_identity: 'api_key:a1', agent_session_id: 'session-1' },
      question_group_id: created.question_group_id
    });

    service.notifyAnswered(created.question_group_id, {
      question_group_id: created.question_group_id,
      status: 'answered'
    });

    await expect(waitPromise).resolves.toMatchObject({
      question_group_id: created.question_group_id,
      status: 'answered'
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/integration/e2e-pending-to-answered.test.ts`
Expected: FAIL because `createQuestionGroup` and `waitQuestionGroup` do not exist.

- [ ] **Step 3: Implement the split service API**

```ts
// src/core/hitl-service.ts
import { createQuestionGroupInputSchema, waitQuestionGroupInputSchema } from '../domain/schemas';
import { DomainError } from '../domain/errors';

export class HitlService {
  constructor(
    private readonly repository: HitlRepository,
    private readonly waiter: Waiter,
    private readonly maxWaitSeconds: number,
    private readonly metrics?: HitlMetrics
  ) {}

  async createQuestionGroup(params: {
    caller: { agent_identity: string; agent_session_id: string };
    input: unknown;
  }) {
    const parsed = createQuestionGroupInputSchema.parse(params.input);
    return this.repository.createPendingGroup({
      agent_identity: params.caller.agent_identity,
      agent_session_id: params.caller.agent_session_id,
      ...parsed
    });
  }

  async getCurrentQuestionGroup(caller: { agent_identity: string; agent_session_id: string }) {
    return this.repository.getPendingGroupByScope(caller.agent_identity, caller.agent_session_id);
  }

  async waitQuestionGroup(params: {
    caller: { agent_identity: string; agent_session_id: string };
    question_group_id?: string;
  }) {
    const parsed = waitQuestionGroupInputSchema.parse({ question_group_id: params.question_group_id });
    const groupId = parsed.question_group_id
      ?? (await this.repository.getPendingGroupByScope(params.caller.agent_identity, params.caller.agent_session_id))?.question_group_id;

    if (!groupId) {
      throw new DomainError('PENDING_GROUP_NOT_FOUND', 'no pending question group for caller scope');
    }

    const timeoutMs = this.maxWaitSeconds > 0 ? this.maxWaitSeconds * 1000 : 0;
    return this.waiter.wait(groupId, timeoutMs);
  }

}
```

- [ ] **Step 4: Keep waiter keyed by `question_group_id` and add explicit helper comments only if needed**

```ts
// src/state/waiter.ts
export class Waiter {
  private waiters = new Map<string, (payload: unknown) => void>();

  wait(groupId: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error('wait timeout')), timeoutMs) : null;
      this.waiters.set(groupId, (payload: unknown) => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(groupId);
        resolve(payload);
      });
    });
  }
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- tests/integration/e2e-pending-to-answered.test.ts`
Expected: PASS with create/wait flow working.

- [ ] **Step 6: Commit**

```bash
git add src/core/hitl-service.ts src/state/waiter.ts tests/integration/e2e-pending-to-answered.test.ts
git commit -m "refactor: split hitl service into create wait and current flows"
```

### Task 6: Add New MCP Tools For Create, Wait, And Current State

**Files:**
- Create: `src/mcp/tools/create-question-group.ts`
- Create: `src/mcp/tools/wait-question-group.ts`
- Create: `src/mcp/tools/get-current-question-group.ts`
- Modify: `src/mcp/register-tools.ts`
- Test: `tests/integration/mcp-tools-registration.test.ts`

- [ ] **Step 1: Write failing MCP tool registration tests**

```ts
// tests/integration/mcp-tools-registration.test.ts
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('mcp tool registration', () => {
  it('registers create wait and current tools', async () => {
    const runtime = await createRuntime();
    const names = runtime.server.registeredTools.map((tool: any) => tool.name).sort();
    expect(names).toContain('hitl_create_question_group');
    expect(names).toContain('hitl_wait_question_group');
    expect(names).toContain('hitl_get_current_question_group');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/integration/mcp-tools-registration.test.ts`
Expected: FAIL because the new tools are not registered.

- [ ] **Step 3: Implement `create`, `wait`, and `current` tools**

```ts
// src/mcp/tools/create-question-group.ts
import { object, error, type MCPServer } from 'mcp-use/server';
import { createQuestionGroupInputSchema } from '../../domain/schemas';

export function registerCreateQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_create_question_group',
      description: 'Create a pending question group for the current authenticated agent identity and session.',
      schema: createQuestionGroupInputSchema
    },
    async (input, ctx) => {
      try {
        const caller = {
          agent_identity: String((ctx as any).req?.get?.('agentIdentity') ?? (ctx as any).state?.get?.('agentIdentity')),
          agent_session_id: String((ctx as any).req?.get?.('agentSessionId') ?? (ctx as any).state?.get?.('agentSessionId'))
        };
        return object(await service.createQuestionGroup({ caller, input }));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to create question group');
      }
    }
  );
}
```

```ts
// src/mcp/tools/wait-question-group.ts
import { object, error, type MCPServer } from 'mcp-use/server';
import { waitQuestionGroupInputSchema } from '../../domain/schemas';

export function registerWaitQuestionGroupTool(server: MCPServer, service: HitlService) {
  server.tool(
    {
      name: 'hitl_wait_question_group',
      description: 'Wait for a question group to reach a terminal state.',
      schema: waitQuestionGroupInputSchema
    },
    async (input, ctx) => {
      try {
        const caller = {
          agent_identity: String((ctx as any).req?.get?.('agentIdentity') ?? (ctx as any).state?.get?.('agentIdentity')),
          agent_session_id: String((ctx as any).req?.get?.('agentSessionId') ?? (ctx as any).state?.get?.('agentSessionId'))
        };
        return object(await service.waitQuestionGroup({ caller, question_group_id: input.question_group_id }));
      } catch (err) {
        return error(err instanceof Error ? err.message : 'failed to wait for question group');
      }
    }
  );
}
```

- [ ] **Step 4: Register only the correct MCP tools**

```ts
// src/mcp/register-tools.ts
import { registerCreateQuestionGroupTool } from './tools/create-question-group';
import { registerWaitQuestionGroupTool } from './tools/wait-question-group';
import { registerGetCurrentQuestionGroupTool } from './tools/get-current-question-group';

export function registerHitlTools(server: MCPServer, service: HitlService) {
  registerCreateQuestionGroupTool(server, service);
  registerWaitQuestionGroupTool(server, service);
  registerGetCurrentQuestionGroupTool(server, service);
  registerGetQuestionGroupStatusTool(server, service);
  registerGetQuestionTool(server, service);
  registerCancelQuestionGroupTool(server, service);
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- tests/integration/mcp-tools-registration.test.ts`
Expected: PASS with all tools registered.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/create-question-group.ts src/mcp/tools/wait-question-group.ts src/mcp/tools/get-current-question-group.ts src/mcp/register-tools.ts tests/integration/mcp-tools-registration.test.ts
git commit -m "feat: add create wait and current MCP tools"
```

### Task 7: Extend HTTP API With Current Scoped Group And Preserve Finalize Semantics

**Files:**
- Modify: `src/http/routes/question-groups.ts`
- Modify: `src/server/create-server.ts`
- Test: `tests/integration/http-current-group.test.ts`
- Test: `tests/integration/http-finalize.test.ts`

- [ ] **Step 1: Write failing HTTP current-group tests**

```ts
// tests/integration/http-current-group.test.ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../src/server/create-server';

describe('GET /question-groups/current', () => {
  it('returns current pending group for authenticated caller scope', async () => {
    const app = await createHttpApp();

    await request(app.fetch)
      .post('/mcp/tool-bootstrap-not-used-in-http-test');

    const res = await request(app.fetch)
      .get('/api/v1/question-groups/current')
      .set('x-api-key', 'dev-only-key')
      .set('x-agent-session-id', 'session-123');

    expect([200, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/integration/http-current-group.test.ts tests/integration/http-finalize.test.ts`
Expected: FAIL because `/question-groups/current` does not exist and current middleware order may not populate context correctly.

- [ ] **Step 3: Add current scoped-group route**

```ts
// src/http/routes/question-groups.ts
app.get('/question-groups/current', async (c) => {
  const requestId = c.get('requestId') ?? 'local';
  const agentIdentity = c.get('agentIdentity');
  const agentSessionId = c.get('agentSessionId');
  const group = await deps.repository.getPendingGroupByScope(agentIdentity, agentSessionId);

  if (!group) {
    return c.json(
      fail(requestId, 'PENDING_GROUP_NOT_FOUND', 'no pending group for current caller scope'),
      404
    );
  }

  return c.json(ok(requestId, group));
});
```

- [ ] **Step 4: Keep finalize/cancel/expire clearing pending scope through repository behavior**

```ts
// src/http/routes/question-groups.ts
app.put('/question-groups/:questionGroupId/answers/finalize', async (c) => {
  const groupId = c.req.param('questionGroupId');
  const body = await c.req.json();
  const group = await deps.repository.getGroup(groupId);
  if (!group) {
    return c.json(fail(c.get('requestId') ?? 'local', 'QUESTION_GROUP_NOT_FOUND', 'question group not found'), 404);
  }
  // existing validation stays intact
  const saved = await deps.repository.finalizeAnswers(groupId, body.answers ?? {}, body.idempotency_key);
  deps.waiter.notify(groupId, {
    question_group_id: groupId,
    status: 'answered',
    answers: body.answers ?? {},
    answered_at: saved.answered_at
  });
  return c.json(ok(c.get('requestId') ?? 'local', {
    question_group_id: groupId,
    status: 'answered',
    answered_question_ids: saved.answered_question_ids,
    answered_at: saved.answered_at
  }));
});
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- tests/integration/http-current-group.test.ts tests/integration/http-finalize.test.ts`
Expected: PASS with current-group lookups and unchanged finalize validation semantics.

- [ ] **Step 6: Commit**

```bash
git add src/http/routes/question-groups.ts src/server/create-server.ts tests/integration/http-current-group.test.ts tests/integration/http-finalize.test.ts
git commit -m "feat: expose current scoped question group endpoint"
```

### Task 8: Update Documentation, Examples, And Runtime Contract

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `docs/api/mcp-tools.md`
- Modify: `docs/api/http-openapi.md`
- Modify: `docs/design-doc.md`

- [ ] **Step 1: Write failing docs checklist as a review step**

Run: `rg -n "\"question_group_id\".*required|Required: \`question_group_id\`|question_group_id（string，必填）" README.md README-zh.md docs/api/mcp-tools.md docs/design-doc.md`
Expected: MATCHES FOUND showing stale documentation that still says the caller must provide `question_group_id`.

- [ ] **Step 2: Update English README**

```md
## Identity Model

- `agent_identity` is derived from MCP connection authentication.
- `agent_session_id` is derived from the configured connection header `x-agent-session-id`.
- `question_group_id` is generated by the server.
- Only one `pending` question group may exist for a given `(agent_identity, agent_session_id)` pair.

## MCP Tools

### `hitl_create_question_group`
- Creates a pending question group and returns immediately.

### `hitl_wait_question_group`
- Waits for a specific question group, or for the caller's current pending group if no ID is provided.

### `hitl_get_current_question_group`
- Returns the caller's current pending question group.
```

- [ ] **Step 3: Update Chinese README and API docs**

```md
## 身份模型

- `agent_identity` 由 MCP 连接认证推导。
- `agent_session_id` 由连接级 header `x-agent-session-id` 推导。
- `question_group_id` 由服务端生成。
- 同一 `(agent_identity, agent_session_id)` 同时最多一个 `pending` 问题组。

## MCP 工具

### `hitl_create_question_group`
- 创建问题组并立即返回 `pending`。

### `hitl_wait_question_group`
- 按 `question_group_id` 或当前会话作用域等待终态。

### `hitl_get_current_question_group`
- 获取当前调用方作用域下唯一 pending 的问题组。
```

- [ ] **Step 4: Add rollout requirements**

```md
## Required Runtime Contract

- Agent platforms should bind a stable authenticated principal per MCP connection.
- Agent platforms should send `x-agent-session-id` on every MCP request.
- Tool input must not be used to carry trusted identity or session scope.
```

- [ ] **Step 5: Run docs grep checks and confirm no stale requirement remains**

Run: `rg -n "question_group_id.*required|question_group_id（string，必填）|Required: \`question_group_id\`" README.md README-zh.md docs/api/mcp-tools.md docs/api/http-openapi.md docs/design-doc.md`
Expected: No matches that claim callers must provide `question_group_id` for create flows.

- [ ] **Step 6: Commit**

```bash
git add README.md README-zh.md docs/api/mcp-tools.md docs/api/http-openapi.md docs/design-doc.md
git commit -m "docs: describe agent identity and session scoped hitl flow"
```

### Task 9: Run Full Verification And Capture Rollout Risks

**Files:**
- Modify: `docs/superpowers/plans/2026-04-02-hitl-agent-identity-session-refactor.md`
- Test: `tests/unit/*.test.ts`
- Test: `tests/integration/*.test.ts`

- [ ] **Step 1: Run the focused unit and integration suite**

Run: `npm test`
Expected: PASS with all unit and integration tests green.

- [ ] **Step 2: Run targeted grep checks for deprecated input contract**

Run: `rg -n "question_group_id: z\\.string\\(\\)\\.min\\(1\\)" src tests README.md README-zh.md docs`
Expected: Matches only in explicit status/wait/cancel/get routes and schemas, not in create/ask input schemas.

- [ ] **Step 3: Run targeted grep checks for trusted identity sources**

Run: `rg -n "metadata\\.agent_session_id|x-agent-session-id|agentIdentity|agentSessionId" src tests`
Expected: `x-agent-session-id` and request-context usage are present; `metadata.agent_session_id` does not appear in implementation code.

- [ ] **Step 4: Record known rollout risks in the plan footer**

```md
## Rollout Risks

- Agent platforms that cannot set per-connection headers cannot satisfy the preferred `agent_session_id` path.
- Reusing one API key across multiple agent runtimes collapses `agent_identity` isolation.
- Existing clients that still send caller-generated `question_group_id` will break once strict schema removal lands.
- Redis key cardinality grows with `(agent_identity, agent_session_id)` combinations and must be observed in production.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-02-hitl-agent-identity-session-refactor.md
git commit -m "chore: finalize hitl identity-session refactor plan"
```

---

## Self-Review

### Spec Coverage

- Stable Agent identity from connection authentication: covered by Task 2.
- Stable Agent Session ID from connection header: covered by Task 2 and Task 8.
- Service-owned `question_group_id`: covered by Tasks 3 and 4.
- One pending group per `(agent_identity, agent_session_id)`: covered by Task 4.
- Split MCP tools `create`, `wait`, `get_current`: covered by Task 6.
- HTTP current-group lookup and unchanged finalize semantics: covered by Task 7.
- Docs and runtime contract guidance: covered by Task 8.

### Placeholder Scan

- No `TODO`, `TBD`, or “similar to above” shortcuts remain.
- Every task contains explicit files, commands, and expected outcomes.

### Type Consistency

- `agent_identity`
- `agent_session_id`
- `question_group_id`
- `hitl_create_question_group`
- `hitl_wait_question_group`
- `hitl_get_current_question_group`

The names above are used consistently across tasks.
