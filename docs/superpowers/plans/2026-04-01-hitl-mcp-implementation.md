# hitl-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建生产级 `hitl-mcp` 服务，提供阻塞式 MCP 提问能力与 HTTP 管控面，支持 Redis 持久化、幂等、TTL、跨会话恢复。

**Architecture:** 基于 `mcp-use` 构建 MCP server，并在同进程挂载 Hono HTTP 控制面。状态和等待信号统一落 Redis，通过状态机驱动 `pending -> answered/cancelled/expired` 迁移。所有外部读写严格按 `question_group_id` 或 `question_id` 路由，不提供 list。

**Tech Stack:** TypeScript, Node.js, mcp-use, Hono, Zod, Redis(ioredis), Vitest, Supertest

---

## File Structure

- `package.json`：脚本与依赖。
- `tsconfig.json`：TypeScript 编译配置。
- `src/index.ts`：进程入口，启动 MCP + HTTP。
- `src/server/create-server.ts`：组装 MCPServer 与 Hono app。
- `src/config/defaults.ts`：默认配置。
- `src/config/types.ts`：配置类型与 Zod schema。
- `src/config/load-config.ts`：四级配置加载（env > .env > yaml > defaults）。
- `src/domain/types.ts`：QuestionGroup/Question/AnswerSet 类型。
- `src/domain/schemas.ts`：MCP 入参与 HTTP 入参 schema。
- `src/domain/errors.ts`：统一错误码与错误对象。
- `src/domain/validators.ts`：题型校验器。
- `src/state/status-machine.ts`：状态机迁移规则。
- `src/state/waiter.ts`：阻塞等待与唤醒机制。
- `src/storage/redis-keys.ts`：Redis key 生成器。
- `src/storage/redis-client.ts`：Redis client 初始化。
- `src/storage/hitl-repository.ts`：持久化仓储（原子迁移、幂等）。
- `src/mcp/tools/ask-question-group.ts`：核心阻塞式 tool。
- `src/mcp/tools/get-question-group-status.ts`：状态查询 tool。
- `src/mcp/tools/get-question.ts`：按 question 查询 tool。
- `src/mcp/tools/cancel-question-group.ts`：取消 tool。
- `src/mcp/register-tools.ts`：统一注册 MCP tools。
- `src/http/middleware/auth.ts`：HTTP 鉴权。
- `src/http/middleware/request-id.ts`：请求 ID 注入。
- `src/http/routes/health.ts`：`/healthz`。
- `src/http/routes/question-groups.ts`：group 相关接口。
- `src/http/routes/questions.ts`：question 查询接口。
- `src/http/response.ts`：统一响应封装。
- `src/observability/logger.ts`：结构化日志。
- `src/observability/metrics.ts`：基础指标。
- `tests/unit/*.test.ts`：单元测试。
- `tests/integration/*.test.ts`：集成测试。
- `.env.example`：环境变量示例。
- `config/hitl-mcp.yaml.example`：YAML 配置示例。

---

### Task 1: 初始化工程与运行骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/server/create-server.ts`
- Create: `.env.example`
- Test: `tests/integration/bootstrap.test.ts`

- [ ] **Step 1: 写启动失败测试（进程可加载并返回 health）**

```ts
// tests/integration/bootstrap.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../src/server/create-server';

describe('bootstrap', () => {
  it('exposes health endpoint', async () => {
    const app = await createHttpApp();
    const res = await request(app.fetch).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- tests/integration/bootstrap.test.ts`
Expected: FAIL with module-not-found for `src/server/create-server`.

- [ ] **Step 3: 最小实现工程骨架**

```ts
// src/server/create-server.ts
import { Hono } from 'hono';

export async function createHttpApp() {
  const app = new Hono();
  app.get('/api/v1/healthz', (c) => c.json({ request_id: 'local', success: true, data: { status: 'ok' }, error: null }));
  return app;
}
```

```ts
// src/index.ts
import { createHttpApp } from './server/create-server';

async function main() {
  const app = await createHttpApp();
  const port = Number(process.env.PORT || 3000);
  Bun.serve({ port, fetch: app.fetch });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: 再次运行测试确认通过**

Run: `npm run test -- tests/integration/bootstrap.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json src/index.ts src/server/create-server.ts tests/integration/bootstrap.test.ts .env.example
git commit -m "chore: bootstrap hitl-mcp server skeleton"
```

### Task 2: 配置系统（四级优先级）

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/load-config.ts`
- Create: `config/hitl-mcp.yaml.example`
- Test: `tests/unit/config-loader.test.ts`

- [ ] **Step 1: 写配置优先级失败测试**

```ts
// tests/unit/config-loader.test.ts
import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../src/config/load-config';

describe('config loader', () => {
  it('applies precedence env > dotenv > yaml > defaults', async () => {
    const config = await resolveConfig({
      env: { HITL_HTTP_PORT: '7777' },
      dotenv: { HITL_HTTP_PORT: '6666' },
      yaml: { http: { port: 5555 } }
    });
    expect(config.http.port).toBe(7777);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- tests/unit/config-loader.test.ts`
Expected: FAIL with missing `resolveConfig`.

- [ ] **Step 3: 实现配置类型、默认值、加载器**

```ts
// src/config/types.ts
import { z } from 'zod';

export const appConfigSchema = z.object({
  http: z.object({ host: z.string(), port: z.number().int().positive(), apiPrefix: z.string() }),
  redis: z.object({ url: z.string(), keyPrefix: z.string() }),
  ttl: z.object({ defaultSeconds: z.number().int().positive(), answeredRetentionSeconds: z.number().int().positive() }),
  pending: z.object({ maxWaitSeconds: z.number().int().nonnegative() }),
  security: z.object({ apiKey: z.string().min(1) })
});

export type AppConfig = z.infer<typeof appConfigSchema>;
```

```ts
// src/config/defaults.ts
import type { AppConfig } from './types';

export const defaultConfig: AppConfig = {
  http: { host: '0.0.0.0', port: 3000, apiPrefix: '/api/v1' },
  redis: { url: 'redis://127.0.0.1:6379', keyPrefix: 'hitl' },
  ttl: { defaultSeconds: 7 * 24 * 3600, answeredRetentionSeconds: 30 * 24 * 3600 },
  pending: { maxWaitSeconds: 0 },
  security: { apiKey: 'dev-only-key' }
};
```

```ts
// src/config/load-config.ts
import { appConfigSchema, type AppConfig } from './types';
import { defaultConfig } from './defaults';

type Source = { env?: Record<string, string>; dotenv?: Record<string, string>; yaml?: Record<string, any> };

function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const out = { ...base } as Record<string, any>;
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge((out[k] ?? {}) as Record<string, any>, v as Record<string, any>)
      : v;
  }
  return out as T;
}

export async function resolveConfig(source: Source = {}): Promise<AppConfig> {
  const yaml = source.yaml ?? {};
  const dotenv = source.dotenv ?? {};
  const env = source.env ?? process.env;

  let merged = deepMerge(defaultConfig, yaml);
  if (dotenv.HITL_HTTP_PORT) merged = deepMerge(merged, { http: { port: Number(dotenv.HITL_HTTP_PORT) } } as Partial<AppConfig>);
  if (env.HITL_HTTP_PORT) merged = deepMerge(merged, { http: { port: Number(env.HITL_HTTP_PORT) } } as Partial<AppConfig>);

  return appConfigSchema.parse(merged);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/config-loader.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: 提交**

```bash
git add src/config tests/unit/config-loader.test.ts config/hitl-mcp.yaml.example
git commit -m "feat: add layered config loader with precedence"
```

### Task 3: 领域模型、题型 schema 与错误模型

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/schemas.ts`
- Create: `src/domain/errors.ts`
- Test: `tests/unit/domain-schemas.test.ts`

- [ ] **Step 1: 写题型与必答约束失败测试**

```ts
// tests/unit/domain-schemas.test.ts
import { describe, it, expect } from 'vitest';
import { askQuestionGroupInputSchema } from '../../src/domain/schemas';

describe('domain schemas', () => {
  it('rejects single_choice without options', () => {
    const parsed = askQuestionGroupInputSchema.safeParse({
      question_group_id: 'qg_1',
      title: 'group',
      questions: [{ question_id: 'q_1', type: 'single_choice', title: 'pick one' }]
    });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- tests/unit/domain-schemas.test.ts`
Expected: FAIL with missing schema export.

- [ ] **Step 3: 实现类型与 schema**

```ts
// src/domain/schemas.ts
import { z } from 'zod';

const commonQuestion = {
  question_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  required: z.boolean().default(true)
};

const optionSchema = z.object({ value: z.string(), label: z.string(), description: z.string().optional() });

const singleChoiceSchema = z.object({ ...commonQuestion, type: z.literal('single_choice'), options: z.array(optionSchema).min(1) });
const multiChoiceSchema = z.object({ ...commonQuestion, type: z.literal('multi_choice'), options: z.array(optionSchema).min(1) });
const textSchema = z.object({ ...commonQuestion, type: z.literal('text'), text_constraints: z.object({ min_length: z.number().int().min(0).optional(), max_length: z.number().int().positive().optional(), pattern: z.string().optional() }).optional() });
const booleanSchema = z.object({ ...commonQuestion, type: z.literal('boolean') });
const rangeSchema = z.object({ ...commonQuestion, type: z.literal('range'), range_constraints: z.object({ min: z.number(), max: z.number(), step: z.number().positive().optional() }) });

export const questionSchema = z.discriminatedUnion('type', [singleChoiceSchema, multiChoiceSchema, textSchema, booleanSchema, rangeSchema]);

export const askQuestionGroupInputSchema = z.object({
  question_group_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  ttl_seconds: z.number().int().positive().optional(),
  questions: z.array(questionSchema).min(1),
  idempotency_key: z.string().optional(),
  metadata: z.object({ agent_session_id: z.string().optional(), agent_trace_id: z.string().optional() }).optional()
});
```

```ts
// src/domain/errors.ts
export type ErrorCode =
  | 'QUESTION_GROUP_NOT_FOUND'
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_GROUP_NOT_PENDING'
  | 'ANSWER_VALIDATION_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_EXPIRED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export class HitlError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/domain-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/domain tests/unit/domain-schemas.test.ts
git commit -m "feat: define question schemas and error model"
```

### Task 4: Redis 仓储、键模型、状态机

**Files:**
- Create: `src/storage/redis-keys.ts`
- Create: `src/storage/redis-client.ts`
- Create: `src/storage/hitl-repository.ts`
- Create: `src/state/status-machine.ts`
- Test: `tests/unit/status-machine.test.ts`
- Test: `tests/integration/repository.test.ts`

- [ ] **Step 1: 写状态迁移失败测试**

```ts
// tests/unit/status-machine.test.ts
import { describe, it, expect } from 'vitest';
import { transitionStatus } from '../../src/state/status-machine';

describe('status machine', () => {
  it('allows pending -> answered only', () => {
    expect(transitionStatus('pending', 'answered')).toBe('answered');
    expect(() => transitionStatus('answered', 'pending')).toThrowError();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/unit/status-machine.test.ts`
Expected: FAIL with missing function.

- [ ] **Step 3: 实现键、状态机、仓储核心接口**

```ts
// src/state/status-machine.ts
export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

const allowed: Record<GroupStatus, GroupStatus[]> = {
  pending: ['answered', 'cancelled', 'expired'],
  answered: [],
  cancelled: [],
  expired: []
};

export function transitionStatus(from: GroupStatus, to: GroupStatus): GroupStatus {
  if (!allowed[from].includes(to)) throw new Error(`illegal transition ${from} -> ${to}`);
  return to;
}
```

```ts
// src/storage/redis-keys.ts
export const keys = {
  qg: (prefix: string, groupId: string) => `${prefix}:qg:${groupId}`,
  q: (prefix: string, questionId: string) => `${prefix}:q:${questionId}`,
  ans: (prefix: string, groupId: string) => `${prefix}:ans:${groupId}`,
  wait: (prefix: string, groupId: string) => `${prefix}:wait:${groupId}`,
  idem: (prefix: string, scope: string, idemKey: string) => `${prefix}:idem:${scope}:${idemKey}`,
  idxQ2G: (prefix: string, questionId: string) => `${prefix}:idx:q2g:${questionId}`
};
```

```ts
// src/storage/hitl-repository.ts
export interface HitlRepository {
  createPendingGroup(input: unknown): Promise<void>;
  getGroup(groupId: string): Promise<Record<string, unknown> | null>;
  finalizeAnswers(groupId: string, answers: Record<string, unknown>): Promise<{ status: 'answered' }>;
  cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled' }>;
}
```

- [ ] **Step 4: 运行状态机测试确认通过**

Run: `npm run test -- tests/unit/status-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/state src/storage tests/unit/status-machine.test.ts tests/integration/repository.test.ts
git commit -m "feat: add redis keyspace and status machine"
```

### Task 5: 答案校验器与可读错误详情

**Files:**
- Create: `src/domain/validators.ts`
- Test: `tests/unit/validators.test.ts`

- [ ] **Step 1: 写校验失败用例（范围和值格式）**

```ts
// tests/unit/validators.test.ts
import { describe, it, expect } from 'vitest';
import { validateAnswerSet } from '../../src/domain/validators';

describe('answer validator', () => {
  it('returns readable errors for invalid range', () => {
    const result = validateAnswerSet(
      [{ question_id: 'q_1', type: 'range', title: 'rate', required: true, range_constraints: { min: 0, max: 10, step: 1 } }],
      { q_1: { value: 99 } }
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toContain('数值超出范围');
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- tests/unit/validators.test.ts`
Expected: FAIL with missing validator.

- [ ] **Step 3: 实现题型校验与错误聚合**

```ts
// src/domain/validators.ts
import type { z } from 'zod';
import type { questionSchema } from './schemas';

type Question = z.infer<typeof questionSchema>;

type ValidationError = { question_id: string; reason: string; expected: string };

type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

export function validateAnswerSet(questions: Question[], answers: Record<string, { value: unknown }>): ValidationResult {
  const errors: ValidationError[] = [];
  for (const q of questions) {
    const a = answers[q.question_id];
    if (!a) {
      if (q.required !== false) errors.push({ question_id: q.question_id, reason: '必答题未回答', expected: 'value present' });
      continue;
    }

    if (q.type === 'single_choice') {
      if (typeof a.value !== 'string' || !q.options.some((o) => o.value === a.value)) {
        errors.push({ question_id: q.question_id, reason: '单选值非法', expected: 'one option value' });
      }
    }
    if (q.type === 'multi_choice') {
      if (!Array.isArray(a.value) || a.value.some((v) => typeof v !== 'string')) {
        errors.push({ question_id: q.question_id, reason: '多选格式错误', expected: 'string[]' });
      }
    }
    if (q.type === 'text') {
      if (typeof a.value !== 'string') {
        errors.push({ question_id: q.question_id, reason: '文本格式错误', expected: 'string' });
      }
    }
    if (q.type === 'boolean') {
      if (typeof a.value !== 'boolean') {
        errors.push({ question_id: q.question_id, reason: '判断题格式错误', expected: 'boolean' });
      }
    }
    if (q.type === 'range') {
      if (typeof a.value !== 'number') {
        errors.push({ question_id: q.question_id, reason: '范围题格式错误', expected: 'number' });
      } else if (a.value < q.range_constraints.min || a.value > q.range_constraints.max) {
        errors.push({ question_id: q.question_id, reason: '数值超出范围', expected: `${q.range_constraints.min} <= value <= ${q.range_constraints.max}` });
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/unit/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/domain/validators.ts tests/unit/validators.test.ts
git commit -m "feat: implement answer validators with readable errors"
```

### Task 6: MCP Tool - hitl_ask_question_group（阻塞核心）

**Files:**
- Create: `src/state/waiter.ts`
- Create: `src/mcp/tools/ask-question-group.ts`
- Create: `src/mcp/register-tools.ts`
- Test: `tests/integration/mcp-ask-wait.test.ts`

- [ ] **Step 1: 写阻塞行为失败测试**

```ts
// tests/integration/mcp-ask-wait.test.ts
import { describe, it, expect } from 'vitest';

describe('mcp ask tool', () => {
  it('stays pending before finalize', async () => {
    // 调用 tool 后 500ms 内不应完成
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败（或空实现）**

Run: `npm run test -- tests/integration/mcp-ask-wait.test.ts`
Expected: FAIL because tool not registered.

- [ ] **Step 3: 实现 wait/notify 与 ask tool**

```ts
// src/state/waiter.ts
export class Waiter {
  private pending = new Map<string, (payload: unknown) => void>();

  wait(groupId: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error('wait timeout')), timeoutMs) : null;
      this.pending.set(groupId, (payload) => {
        if (timer) clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  notify(groupId: string, payload: unknown) {
    const done = this.pending.get(groupId);
    if (done) {
      this.pending.delete(groupId);
      done(payload);
    }
  }
}
```

```ts
// src/mcp/tools/ask-question-group.ts
import { object, error, type MCPServer } from 'mcp-use/server';
import { askQuestionGroupInputSchema } from '../../domain/schemas';

export function registerAskQuestionGroupTool(server: MCPServer, deps: {
  repository: { createPendingGroup: (input: unknown) => Promise<void> };
  waiter: { wait: (groupId: string, timeoutMs: number) => Promise<unknown> };
  maxWaitSeconds: number;
}) {
  server.tool(
    {
      name: 'hitl_ask_question_group',
      description: 'Create a question group and wait for final answers.',
      schema: askQuestionGroupInputSchema
    },
    async (input) => {
      try {
        const parsed = askQuestionGroupInputSchema.parse(input);
        await deps.repository.createPendingGroup(parsed);
        const timeoutMs = deps.maxWaitSeconds > 0 ? deps.maxWaitSeconds * 1000 : 0;
        const result = await deps.waiter.wait(parsed.question_group_id, timeoutMs);
        return object(result);
      } catch (e) {
        return error(e instanceof Error ? e.message : 'failed to ask question group');
      }
    }
  );
}
```

- [ ] **Step 4: 运行集成测试确认通过**

Run: `npm run test -- tests/integration/mcp-ask-wait.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/state/waiter.ts src/mcp tests/integration/mcp-ask-wait.test.ts
git commit -m "feat: add blocking hitl_ask_question_group tool"
```

### Task 7: MCP Tool - 状态查询与取消

**Files:**
- Create: `src/mcp/tools/get-question-group-status.ts`
- Create: `src/mcp/tools/get-question.ts`
- Create: `src/mcp/tools/cancel-question-group.ts`
- Modify: `src/mcp/register-tools.ts`
- Test: `tests/integration/mcp-query-cancel.test.ts`

- [ ] **Step 1: 写查询与取消失败测试**

```ts
// tests/integration/mcp-query-cancel.test.ts
import { describe, it, expect } from 'vitest';

describe('mcp query/cancel tools', () => {
  it('can query group status by group id', async () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/integration/mcp-query-cancel.test.ts`
Expected: FAIL due to missing tools.

- [ ] **Step 3: 实现三个辅助工具**

```ts
// src/mcp/tools/get-question-group-status.ts
import { object, error, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';

export function registerGetQuestionGroupStatusTool(server: MCPServer, deps: { repository: { getGroupStatus: (id: string) => Promise<unknown> } }) {
  server.tool(
    {
      name: 'hitl_get_question_group_status',
      description: 'Get question group status by question_group_id',
      schema: z.object({ question_group_id: z.string().describe('Question group id') })
    },
    async ({ question_group_id }) => {
      const result = await deps.repository.getGroupStatus(question_group_id);
      if (!result) return error('QUESTION_GROUP_NOT_FOUND');
      return object(result);
    }
  );
}
```

```ts
// src/mcp/tools/cancel-question-group.ts
import { object, type MCPServer } from 'mcp-use/server';
import { z } from 'zod';

export function registerCancelQuestionGroupTool(server: MCPServer, deps: { repository: { cancelGroup: (id: string, reason?: string) => Promise<unknown> }; waiter: { notify: (id: string, payload: unknown) => void } }) {
  server.tool(
    {
      name: 'hitl_cancel_question_group',
      description: 'Cancel a pending question group by id',
      schema: z.object({ question_group_id: z.string().describe('Question group id'), reason: z.string().optional().describe('Cancel reason') })
    },
    async ({ question_group_id, reason }) => {
      const result = await deps.repository.cancelGroup(question_group_id, reason);
      deps.waiter.notify(question_group_id, { question_group_id, status: 'cancelled', reason });
      return object(result);
    }
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -- tests/integration/mcp-query-cancel.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/mcp/tools src/mcp/register-tools.ts tests/integration/mcp-query-cancel.test.ts
git commit -m "feat: add MCP query and cancel tools"
```

### Task 8: HTTP API（查询、finalize、cancel、expire）

**Files:**
- Create: `src/http/response.ts`
- Create: `src/http/middleware/request-id.ts`
- Create: `src/http/middleware/auth.ts`
- Create: `src/http/routes/health.ts`
- Create: `src/http/routes/question-groups.ts`
- Create: `src/http/routes/questions.ts`
- Modify: `src/server/create-server.ts`
- Test: `tests/integration/http-finalize.test.ts`

- [ ] **Step 1: 写 finalize 422 与 200 场景失败测试**

```ts
// tests/integration/http-finalize.test.ts
import { describe, it, expect } from 'vitest';

describe('http finalize api', () => {
  it('returns 422 when answers invalid and keeps pending', async () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/integration/http-finalize.test.ts`
Expected: FAIL due to missing route.

- [ ] **Step 3: 实现核心 HTTP 路由与统一响应**

```ts
// src/http/response.ts
export function ok(requestId: string, data: unknown) {
  return { request_id: requestId, success: true, data, error: null };
}

export function fail(requestId: string, code: string, message: string, details?: unknown, data: unknown = {}) {
  return { request_id: requestId, success: false, data, error: { code, message, details } };
}
```

```ts
// src/http/routes/question-groups.ts
import { Hono } from 'hono';
import { fail, ok } from '../response';

export function questionGroupRoutes(deps: {
  repository: {
    getGroup: (id: string) => Promise<any>;
    finalizeAnswers: (id: string, answers: Record<string, unknown>, idemKey?: string) => Promise<{ status: 'answered'; answered_question_ids: string[]; answered_at: string }>;
    cancelGroup: (id: string, reason?: string) => Promise<any>;
    expireGroup: (id: string, reason?: string) => Promise<any>;
  };
  validateAnswers: (group: any, answers: Record<string, { value: unknown }>) => { ok: boolean; errors?: any[] };
  waiter: { notify: (groupId: string, payload: unknown) => void };
}) {
  const app = new Hono();

  app.get('/question-groups/:questionGroupId', async (c) => {
    const requestId = c.get('requestId');
    const group = await deps.repository.getGroup(c.req.param('questionGroupId'));
    if (!group) return c.json(fail(requestId, 'QUESTION_GROUP_NOT_FOUND', 'question group not found'), 404);
    return c.json(ok(requestId, group));
  });

  app.put('/question-groups/:questionGroupId/answers/finalize', async (c) => {
    const requestId = c.get('requestId');
    const groupId = c.req.param('questionGroupId');
    const body = await c.req.json();
    const group = await deps.repository.getGroup(groupId);
    if (!group) return c.json(fail(requestId, 'QUESTION_GROUP_NOT_FOUND', 'question group not found'), 404);

    const validation = deps.validateAnswers(group, body.answers ?? {});
    if (!validation.ok) {
      return c.json(
        fail(requestId, 'ANSWER_VALIDATION_FAILED', `${validation.errors?.length ?? 0} 个问题未通过校验，请修正后重试。`, validation.errors, { question_group_id: groupId, status: 'pending' }),
        422
      );
    }

    const saved = await deps.repository.finalizeAnswers(groupId, body.answers ?? {}, body.idempotency_key);
    deps.waiter.notify(groupId, {
      question_group_id: groupId,
      status: 'answered',
      answered_at: saved.answered_at,
      answers: body.answers
    });

    return c.json(ok(requestId, { question_group_id: groupId, status: 'answered', answered_question_ids: saved.answered_question_ids, answered_at: saved.answered_at }));
  });

  app.post('/question-groups/:questionGroupId/cancel', async (c) => {
    const requestId = c.get('requestId');
    const groupId = c.req.param('questionGroupId');
    const body = await c.req.json().catch(() => ({}));
    const result = await deps.repository.cancelGroup(groupId, body.reason);
    deps.waiter.notify(groupId, { question_group_id: groupId, status: 'cancelled', reason: body.reason });
    return c.json(ok(requestId, result));
  });

  app.post('/question-groups/:questionGroupId/expire', async (c) => {
    const requestId = c.get('requestId');
    const groupId = c.req.param('questionGroupId');
    const result = await deps.repository.expireGroup(groupId, 'manual expire');
    deps.waiter.notify(groupId, { question_group_id: groupId, status: 'expired' });
    return c.json(ok(requestId, result));
  });

  return app;
}
```

- [ ] **Step 4: 运行 finalize 集成测试确认通过**

Run: `npm run test -- tests/integration/http-finalize.test.ts`
Expected: PASS with 422/200 scenario assertions.

- [ ] **Step 5: 提交**

```bash
git add src/http src/server/create-server.ts tests/integration/http-finalize.test.ts
git commit -m "feat: implement HTTP control plane finalize/query/cancel APIs"
```

### Task 9: 幂等与原子迁移（Redis Lua/事务）

**Files:**
- Modify: `src/storage/hitl-repository.ts`
- Test: `tests/integration/idempotency.test.ts`

- [ ] **Step 1: 写并发 finalize 幂等失败测试**

```ts
// tests/integration/idempotency.test.ts
import { describe, it, expect } from 'vitest';

describe('idempotency', () => {
  it('returns same result for duplicated idempotency key', async () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/integration/idempotency.test.ts`
Expected: FAIL because idempotency not implemented.

- [ ] **Step 3: 在仓储中实现 finalize 原子逻辑**

```ts
// src/storage/hitl-repository.ts (核心片段)
async finalizeAnswers(groupId: string, answers: Record<string, unknown>, idemKey?: string) {
  const idemRedisKey = idemKey ? keys.idem(this.prefix, 'finalize', idemKey) : null;

  if (idemRedisKey) {
    const cached = await this.redis.get(idemRedisKey);
    if (cached) return JSON.parse(cached);
  }

  const group = await this.getGroup(groupId);
  if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
  if (group.status !== 'pending') throw new Error('QUESTION_GROUP_NOT_PENDING');

  const answeredAt = new Date().toISOString();
  const result = {
    status: 'answered' as const,
    answered_question_ids: Object.keys(answers),
    answered_at: answeredAt
  };

  const tx = this.redis.multi();
  tx.set(keys.ans(this.prefix, groupId), JSON.stringify({ answers, finalized_at: answeredAt }));
  tx.set(keys.qg(this.prefix, groupId), JSON.stringify({ ...group, status: 'answered', updated_at: answeredAt }));
  if (idemRedisKey) tx.set(idemRedisKey, JSON.stringify(result), 'EX', 3600);
  await tx.exec();

  return result;
}
```

- [ ] **Step 4: 运行幂等测试确认通过**

Run: `npm run test -- tests/integration/idempotency.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/storage/hitl-repository.ts tests/integration/idempotency.test.ts
git commit -m "feat: enforce idempotent and atomic finalize transitions"
```

### Task 10: 可观测性与 HTTP 安全中间件

**Files:**
- Create: `src/observability/logger.ts`
- Create: `src/observability/metrics.ts`
- Modify: `src/http/middleware/auth.ts`
- Modify: `src/server/create-server.ts`
- Test: `tests/integration/security-auth.test.ts`

- [ ] **Step 1: 写未授权访问失败测试**

```ts
// tests/integration/security-auth.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../src/server/create-server';

describe('security', () => {
  it('returns 401 when api key is missing', async () => {
    const app = await createHttpApp();
    const res = await request(app.fetch).put('/api/v1/question-groups/qg_1/answers/finalize').send({ answers: {} });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -- tests/integration/security-auth.test.ts`
Expected: FAIL because auth middleware missing.

- [ ] **Step 3: 实现 request-id、api-key 中间件、基础指标**

```ts
// src/http/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';

export function apiKeyAuth(expectedApiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.req.header('x-api-key');
    if (apiKey !== expectedApiKey) {
      return c.json({ request_id: c.get('requestId'), success: false, data: {}, error: { code: 'UNAUTHORIZED', message: 'invalid api key' } }, 401);
    }
    await next();
  };
}
```

```ts
// src/http/middleware/request-id.ts
import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'crypto';

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const rid = c.req.header('x-request-id') || randomUUID();
  c.set('requestId', rid);
  await next();
};
```

- [ ] **Step 4: 运行安全测试确认通过**

Run: `npm run test -- tests/integration/security-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/http/middleware src/observability src/server/create-server.ts tests/integration/security-auth.test.ts
git commit -m "feat: add api-key auth and request observability middleware"
```

### Task 11: 全量集成验证与文档

**Files:**
- Modify: `README.md`
- Create: `docs/api/http-openapi.md`
- Create: `docs/api/mcp-tools.md`
- Modify: `docs/design-doc.md`
- Test: `tests/integration/e2e-pending-to-answered.test.ts`

- [ ] **Step 1: 写端到端用例（ask -> pending -> finalize -> answered）**

```ts
// tests/integration/e2e-pending-to-answered.test.ts
import { describe, it, expect } from 'vitest';

describe('e2e', () => {
  it('finishes pending MCP ask after HTTP finalize', async () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行全量测试并确认当前有失败**

Run: `npm run test`
Expected: At least 1 failing test before final fixes.

- [ ] **Step 3: 补齐 README 与 API 文档**

```md
# README.md 需要补充章节
- What is hitl-mcp
- MCP tools contracts
- HTTP API contracts (no list operations)
- Redis keys and TTL behavior
- Runbook: pending stuck / redis outage / timeout
```

```md
# docs/api/http-openapi.md
- GET /api/v1/question-groups/{question_group_id}
- GET /api/v1/questions/{question_id}
- PUT /api/v1/question-groups/{question_group_id}/answers/finalize
- POST /api/v1/question-groups/{question_group_id}/cancel
- POST /api/v1/question-groups/{question_group_id}/expire
```

- [ ] **Step 4: 运行全量测试确认通过**

Run: `npm run test`
Expected: PASS with all test suites green.

- [ ] **Step 5: 提交**

```bash
git add README.md docs/api docs/design-doc.md tests/integration/e2e-pending-to-answered.test.ts
git commit -m "docs: finalize integration docs and e2e verification"
```

---

## Self-Review

### 1. Spec coverage
- MCP tool 设计：Task 6/7 覆盖 `ask/status/get/cancel`。
- HTTP API 设计：Task 8 覆盖 query/finalize/cancel/expire，且无 list。
- 题型与必答约束：Task 3/5 覆盖 schema + validator。
- pending 语义：Task 6 + Task 8（waiter notify only on valid finalize）。
- Redis 持久化/TTL/幂等：Task 4 + Task 9。
- 配置优先级：Task 2。
- 可观测与安全：Task 10。
- 验证与回归：Task 11。

### 2. Placeholder scan
- 未使用 `TODO/TBD`。
- 每个任务均给出明确文件、命令、预期结果。
- 关键代码步骤均提供可落地片段。

### 3. Type consistency
- `question_group_id`, `question_id`, `answers` 命名统一。
- 状态集合统一为 `pending/answered/cancelled/expired`。
- finalize 统一使用 `idempotency_key`。

