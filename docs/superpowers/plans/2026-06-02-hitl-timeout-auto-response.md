# HITL Timeout Auto Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis-only timeout-driven automatic responses with configurable default timeout and polling interval, per-question default answers, timeout metadata, and MCP description guidance without breaking existing MCP or HTTP contracts.

**Architecture:** Extend create schemas and config with additive fields, derive and validate default answers centrally, persist timeout scheduling metadata in Redis, and run a Redis polling worker plus pub/sub subscriber to finalize expired groups and wake in-process waiters safely across multiple instances. Preserve existing service and response status semantics by marking timeout answers with additive metadata instead of new terminal states.

**Tech Stack:** TypeScript, Vitest, Hono, mcp-use, ioredis, ioredis-mock, Redis sorted sets/pub-sub/distributed locks

---

### Task 1: Add Failing Tests For Config And Public Schemas

**Files:**
- Modify: `tests/unit/config-loader.test.ts`
- Modify: `tests/unit/domain-schemas.test.ts`

- [ ] **Step 1: Write the failing config tests**

```ts
it('uses 15 minutes and 5 seconds as timeout defaults', async () => {
  const config = await resolveConfig({ env: {} });

  expect(config.pending.defaultTimeoutSeconds).toBe(900);
  expect(config.pending.timeoutPollIntervalSeconds).toBe(5);
});

it('loads timeout config from env', async () => {
  const config = await resolveConfig({
    env: {
      HITL_PENDING_DEFAULT_TIMEOUT_SECONDS: '1200',
      HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS: '9'
    }
  });

  expect(config.pending.defaultTimeoutSeconds).toBe(1200);
  expect(config.pending.timeoutPollIntervalSeconds).toBe(9);
});
```

- [ ] **Step 2: Run the config test to verify it fails**

Run: `npm test -- tests/unit/config-loader.test.ts`

Expected: FAIL with missing `defaultTimeoutSeconds` / `timeoutPollIntervalSeconds` properties.

- [ ] **Step 3: Write the failing schema tests**

```ts
it('accepts timeout_seconds and default_answer in ask schema', () => {
  const parsed = askQuestionsInputSchema.safeParse({
    title: 'group',
    timeout_seconds: 900,
    questions: [
      {
        type: 'single_choice',
        title: 'approve?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' }
        ],
        default_answer: { value: 'no' }
      }
    ]
  });

  expect(parsed.success).toBe(true);
});

it('rejects non-positive timeout_seconds in ask schema', () => {
  const parsed = askQuestionsInputSchema.safeParse({
    title: 'group',
    timeout_seconds: 0,
    questions: [{ type: 'boolean', title: 'approve?' }]
  });

  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 4: Run the schema test to verify it fails**

Run: `npm test -- tests/unit/domain-schemas.test.ts`

Expected: FAIL because `timeout_seconds` and `default_answer` are not accepted yet.

- [ ] **Step 5: Implement the minimal config and schema changes**

```ts
// src/config/types.ts
pending: z.object({
  maxWaitSeconds: z.number().int().nonnegative(),
  waitMode: z.enum(['terminal_only', 'progressive']),
  defaultTimeoutSeconds: z.number().int().positive(),
  timeoutPollIntervalSeconds: z.number().int().positive()
})
```

```ts
// src/config/defaults.ts
pending: {
  maxWaitSeconds: 0,
  waitMode: 'terminal_only',
  defaultTimeoutSeconds: 900,
  timeoutPollIntervalSeconds: 5
}
```

```ts
// src/config/load-config.ts
if (
  env.HITL_PENDING_MAX_WAIT_SECONDS ||
  env.HITL_WAIT_MODE ||
  env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS ||
  env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS
) {
  mapped.pending = {
    ...(env.HITL_PENDING_MAX_WAIT_SECONDS ? { maxWaitSeconds: Number(env.HITL_PENDING_MAX_WAIT_SECONDS) } : {}),
    ...(env.HITL_WAIT_MODE ? { waitMode: env.HITL_WAIT_MODE as AppConfig['pending']['waitMode'] } : {}),
    ...(env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS
      ? { defaultTimeoutSeconds: Number(env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS) }
      : {}),
    ...(env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS
      ? { timeoutPollIntervalSeconds: Number(env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS) }
      : {})
  } as AppConfig['pending'];
}
```

```ts
// src/domain/schemas.ts
const publicCreateQuestionFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  required: z.boolean().default(true),
  default_answer: z.object({ value: z.any() }).optional()
};

export const askQuestionsInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  ttl_seconds: z.number().int().positive().optional(),
  timeout_seconds: z.number().int().positive().optional(),
  questions: z.array(askQuestionSchema).min(1),
  idempotency_key: z.string().optional()
}).strict();
```

- [ ] **Step 6: Run the focused tests to verify they pass**

Run: `npm test -- tests/unit/config-loader.test.ts tests/unit/domain-schemas.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/unit/config-loader.test.ts tests/unit/domain-schemas.test.ts src/config/types.ts src/config/defaults.ts src/config/load-config.ts src/domain/schemas.ts
git commit -m "feat: add timeout config and create schema fields"
```

### Task 2: Add Default Answer Derivation And Validation

**Files:**
- Create: `src/domain/default-answer.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/validators.ts`
- Create: `tests/unit/default-answer.test.ts`

- [ ] **Step 1: Write the failing derivation tests**

```ts
import { describe, expect, it } from 'vitest';
import { deriveDefaultAnswer, validateQuestionDefaultAnswer } from '../../src/domain/default-answer.js';

describe('default answer derivation', () => {
  it('derives the first single choice option', () => {
    expect(
      deriveDefaultAnswer({
        question_id: 'q_1',
        type: 'single_choice',
        title: 'Pick one',
        options: [
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B' }
        ],
        required: true
      }).value
    ).toBe('A');
  });

  it('derives true for boolean questions', () => {
    expect(
      deriveDefaultAnswer({
        question_id: 'q_1',
        type: 'boolean',
        title: 'Confirm?',
        required: true
      }).value
    ).toBe(true);
  });

  it('rejects invalid explicit default answers', () => {
    const result = validateQuestionDefaultAnswer(
      {
        question_id: 'q_1',
        type: 'range',
        title: 'Score',
        range_constraints: { min: 0, max: 10 },
        required: true
      },
      { value: 99 }
    );

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the default-answer test to verify it fails**

Run: `npm test -- tests/unit/default-answer.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the helper and additive types**

```ts
// src/domain/default-answer.ts
import { DomainError } from './errors.js';
import { validateAnswerSet } from './validators.js';
import type { Question } from './types.js';

export type AnswerValue = { value: unknown };

export function deriveDefaultAnswer(question: Question): AnswerValue {
  if (question.type === 'single_choice') return { value: question.options[0].value };
  if (question.type === 'multi_choice') return { value: [question.options[0].value] };
  if (question.type === 'text') return { value: 'none' };
  if (question.type === 'boolean') return { value: true };
  return { value: question.range_constraints.min };
}

export function validateQuestionDefaultAnswer(question: Question, answer: AnswerValue) {
  return validateAnswerSet([question], { [question.question_id]: answer });
}

export function resolveDefaultAnswer(question: Question, explicit?: AnswerValue) {
  const resolved = explicit ?? deriveDefaultAnswer(question);
  const validation = validateQuestionDefaultAnswer(question, resolved);
  if (!validation.ok) throw new DomainError('ANSWER_VALIDATION_FAILED', 'invalid default answer');
  return resolved;
}
```

```ts
// src/domain/types.ts
export type Question = z.infer<typeof questionSchema> & {
  default_answer?: { value: unknown };
  auto_response_at?: string;
  is_timeout_auto_response?: boolean;
};
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/unit/default-answer.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/default-answer.ts src/domain/types.ts src/domain/validators.ts tests/unit/default-answer.test.ts
git commit -m "feat: add default answer derivation helpers"
```

### Task 3: Persist Timeout Metadata And Default Answers In Repositories

**Files:**
- Modify: `src/storage/hitl-repository.ts`
- Modify: `src/storage/in-memory-repository.ts`
- Modify: `src/storage/redis-hitl-repository.ts`
- Modify: `src/core/hitl-service.ts`
- Modify: `tests/unit/in-memory-repository.test.ts`
- Modify: `tests/unit/redis-repository.test.ts`

- [ ] **Step 1: Write the failing repository tests**

```ts
it('stores resolved timeout settings and default answers in memory', async () => {
  const repository = new InMemoryHitlRepository();

  const created = await repository.createPendingGroup({
    agent_identity: 'api_key:a1',
    agent_session_id: 'session-1',
    title: 'group',
    timeout_seconds: 900,
    questions: [
      {
        type: 'text',
        title: 'why',
        default_answer: { value: 'fallback' }
      }
    ]
  });

  expect(created.timeout_seconds).toBe(900);
  expect(created.questions[0].default_answer).toEqual({ value: 'fallback' });
  expect(created.auto_response_deadline_at).toMatch(/T/);
});
```

```ts
it('stores timeout metadata and timeout zset membership in redis', async () => {
  const created = await repository.createPendingGroup({
    agent_identity: 'api_key:a1',
    agent_session_id: 'session-1',
    title: 'group',
    timeout_seconds: 900,
    questions: [
      {
        type: 'single_choice',
        title: 'pick',
        options: [{ value: 'A', label: 'A' }]
      }
    ]
  });

  const stored = await repository.getGroup(created.question_group_id);
  expect(stored?.timeout_seconds).toBe(900);
  expect(stored?.questions[0]).toEqual(
    expect.objectContaining({
      default_answer: { value: 'A' }
    })
  );
});
```

- [ ] **Step 2: Run the repository tests to verify they fail**

Run: `npm test -- tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts`

Expected: FAIL because timeout metadata is not part of the repository model yet.

- [ ] **Step 3: Implement repository input and create-flow changes**

```ts
// src/storage/hitl-repository.ts
export interface CreatePendingGroupInput {
  agent_identity: string;
  agent_session_id: string;
  title: string;
  description?: string;
  ttl_seconds?: number;
  timeout_seconds: number;
  questions: Array<Record<string, unknown>>;
  idempotency_key?: string;
  extra?: Record<string, unknown>;
}
```

```ts
// src/core/hitl-service.ts
const parsed = askQuestionsInputSchema.parse(params.input);
const timeoutSeconds = parsed.timeout_seconds ?? this.defaultTimeoutSeconds;
const preparedQuestions = parsed.questions.map((question) => {
  const hydrated = { ...question, question_id: `draft_${Math.random()}` };
  return {
    ...question,
    default_answer: resolveDefaultAnswer(hydrated as Question, question.default_answer)
  };
});
```

```ts
// src/storage/in-memory-repository.ts and src/storage/redis-hitl-repository.ts
const deadlineAt = new Date(Date.now() + input.timeout_seconds * 1000).toISOString();
const group: ScopedQuestionGroup = {
  ...existingFields,
  timeout_seconds: input.timeout_seconds,
  auto_response_deadline_at: deadlineAt,
  timeout_status: 'pending',
  questions: input.questions.map((question) => ({
    ...question,
    default_answer: question.default_answer,
    is_timeout_auto_response: false
  }))
};
```

- [ ] **Step 4: Run the focused repository tests to verify they pass**

Run: `npm test -- tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/hitl-repository.ts src/storage/in-memory-repository.ts src/storage/redis-hitl-repository.ts src/core/hitl-service.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts
git commit -m "feat: persist timeout metadata and default answers"
```

### Task 4: Add Redis Timeout Keys, Distributed Locking, And Auto-Response Processing

**Files:**
- Modify: `src/storage/redis-keys.ts`
- Modify: `src/storage/redis-hitl-repository.ts`
- Modify: `tests/unit/redis-repository.test.ts`

- [ ] **Step 1: Write the failing Redis timeout-processing tests**

```ts
it('auto-responds timed out pending questions with timeout metadata', async () => {
  const created = await repository.createPendingGroup({
    agent_identity: 'api_key:a1',
    agent_session_id: 'session-timeout-1',
    title: 'group',
    timeout_seconds: 1,
    questions: [
      {
        type: 'boolean',
        title: 'approve?'
      }
    ]
  });

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const [result] = await repository.processTimedOutGroups?.();
  const stored = await repository.getGroup(created.question_group_id);

  expect(result?.groupId).toBe(created.question_group_id);
  expect(stored?.questions[0]).toEqual(
    expect.objectContaining({
      status: 'answered',
      answer: { value: true },
      is_timeout_auto_response: true
    })
  );
});

it('allows only one processor to claim the same timed out group', async () => {
  const created = await repository.createPendingGroup({
    agent_identity: 'api_key:a1',
    agent_session_id: 'session-timeout-2',
    title: 'group',
    timeout_seconds: 1,
    questions: [{ type: 'text', title: 'why' }]
  });

  await new Promise((resolve) => setTimeout(resolve, 1100));

  const [first, second] = await Promise.all([
    repository.processTimedOutGroups?.(),
    repository.processTimedOutGroups?.()
  ]);

  const processedCount = [...(first ?? []), ...(second ?? [])].filter(
    (entry) => entry.groupId === created.question_group_id
  ).length;

  expect(processedCount).toBe(1);
});
```

- [ ] **Step 2: Run the Redis repository test to verify it fails**

Run: `npm test -- tests/unit/redis-repository.test.ts`

Expected: FAIL because timeout keys and processing methods do not exist yet.

- [ ] **Step 3: Implement Redis timeout indexes and locking**

```ts
// src/storage/redis-keys.ts
timeoutDue: (prefix: string) => `${prefix}:timeout:due`,
timeoutLock: (prefix: string, groupId: string) => `${prefix}:timeout:lock:${groupId}`,
timeoutEvents: (prefix: string) => `${prefix}:timeout:events`
```

```ts
// src/storage/redis-hitl-repository.ts
async processTimedOutGroups(limit = 20): Promise<TimeoutProcessResult[]> {
  const now = Date.now();
  const dueIds = await this.redis.zrangebyscore(redisKeys.timeoutDue(this.prefix), 0, now, 'LIMIT', 0, limit);
  const processed: TimeoutProcessResult[] = [];

  for (const groupId of dueIds) {
    const locked = await this.redis.set(
      redisKeys.timeoutLock(this.prefix, groupId),
      '1',
      'NX',
      'EX',
      Math.max(this.timeoutPollIntervalSeconds * 2, 10)
    );
    if (locked !== 'OK') continue;

    try {
      const result = await this.autoRespondTimedOutGroup(groupId);
      if (result) processed.push(result);
    } finally {
      await this.redis.del(redisKeys.timeoutLock(this.prefix, groupId));
    }
  }

  return processed;
}
```

```ts
async autoRespondTimedOutGroup(groupId: string): Promise<TimeoutProcessResult | null> {
  const group = await this.getGroup(groupId);
  if (!group || group.status !== 'pending') {
    await this.redis.zrem(redisKeys.timeoutDue(this.prefix), groupId);
    return null;
  }

  if (Date.parse(group.auto_response_deadline_at) > Date.now()) return null;

  const pendingQuestions = group.questions.filter((question) => question.status === 'pending');
  if (pendingQuestions.length === 0) {
    await this.redis.zrem(redisKeys.timeoutDue(this.prefix), groupId);
    return null;
  }

  const now = new Date().toISOString();
  for (const question of pendingQuestions) {
    question.answer = question.default_answer;
    question.status = 'answered';
    question.auto_response_at = now;
    question.is_timeout_auto_response = true;
    question.updated_at = now;
  }

  group.updated_at = now;
  group.timeout_status = 'processed';
  group.status = 'answered';
  // persist group, questions, indexes, then return snapshot payload
}
```

- [ ] **Step 4: Run the focused Redis repository tests to verify they pass**

Run: `npm test -- tests/unit/redis-repository.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/redis-keys.ts src/storage/redis-hitl-repository.ts tests/unit/redis-repository.test.ts
git commit -m "feat: add redis timeout processing and locking"
```

### Task 5: Add Redis Polling Worker, Pub/Sub Wakeup, And Wait Integration

**Files:**
- Create: `src/state/redis-timeout-worker.ts`
- Modify: `src/server/create-server.ts`
- Modify: `src/storage/redis-client.ts`
- Modify: `tests/integration/wait-modes.test.ts`
- Create: `tests/integration/redis-timeout-worker.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
it('wakes a terminal waiter after timeout automation in redis mode', async () => {
  process.env.HITL_STORAGE = 'redis';
  process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '1';
  process.env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS = '1';

  const { service } = await createRuntime();
  const caller = {
    agent_identity: 'api_key:test-agent',
    agent_session_id: 'session-redis-timeout'
  };

  await service.askQuestions({
    caller,
    input: {
      title: 'Timed wait',
      questions: [{ type: 'boolean', title: 'Approve?' }]
    }
  });

  const result = await service.wait({ caller });
  expect(result.status).toBe('completed');
  expect(result.resolved_questions[0]).toEqual(
    expect.objectContaining({
      status: 'answered',
      answer: { value: true }
    })
  );
  expect(result.resolved_questions[0].question).toEqual(
    expect.objectContaining({
      is_timeout_auto_response: true
    })
  );
});
```

```ts
it('does not auto-respond in memory mode', async () => {
  delete process.env.HITL_STORAGE;
  process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '1';
  process.env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS = '1';

  const { service } = await createRuntime();
  const caller = {
    agent_identity: 'api_key:test-agent',
    agent_session_id: 'session-memory-timeout'
  };

  await service.askQuestions({
    caller,
    input: {
      title: 'Memory wait',
      questions: [{ type: 'boolean', title: 'Approve?' }]
    }
  });

  const outcome = await Promise.race([
    service.wait({ caller }).then(() => 'resolved'),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 1500))
  ]);

  expect(outcome).toBe('pending');
});
```

- [ ] **Step 2: Run the integration tests to verify they fail**

Run: `npm test -- tests/integration/wait-modes.test.ts tests/integration/redis-timeout-worker.test.ts`

Expected: FAIL because no timeout worker or Redis pub/sub wakeup exists.

- [ ] **Step 3: Implement the worker and subscription wiring**

```ts
// src/state/redis-timeout-worker.ts
export class RedisTimeoutWorker {
  constructor(
    private readonly repository: RedisHitlRepository,
    private readonly publisher: RedisClient,
    private readonly intervalSeconds: number
  ) {}

  start() {
    this.timer = setInterval(async () => {
      const results = await this.repository.processTimedOutGroups();
      for (const result of results) {
        await this.publisher.publish(
          redisKeys.timeoutEvents(this.repository.prefix),
          JSON.stringify(result)
        );
      }
    }, this.intervalSeconds * 1000);
  }
}
```

```ts
// src/server/create-server.ts
if (config.storage.kind === 'redis' && repository instanceof RedisHitlRepository) {
  const subscriber = createRedisClient(config.redis.url);
  await subscriber.connect();
  await subscriber.subscribe(redisKeys.timeoutEvents(config.redis.keyPrefix));
  subscriber.on('message', (_channel, raw) => {
    const event = JSON.parse(raw);
    waiter.notify(event.scopeKey, event.snapshot);
  });

  const publisher = createRedisClient(config.redis.url);
  await publisher.connect();
  const timeoutWorker = new RedisTimeoutWorker(
    repository,
    publisher,
    config.pending.timeoutPollIntervalSeconds
  );
  timeoutWorker.start();
}
```

- [ ] **Step 4: Run the focused integration tests to verify they pass**

Run: `npm test -- tests/integration/wait-modes.test.ts tests/integration/redis-timeout-worker.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/redis-timeout-worker.ts src/server/create-server.ts src/storage/redis-client.ts tests/integration/wait-modes.test.ts tests/integration/redis-timeout-worker.test.ts
git commit -m "feat: add redis timeout worker and waiter wakeup"
```

### Task 6: Expose Timeout Metadata Through HTTP/MCP-Compatible Snapshots

**Files:**
- Modify: `src/storage/in-memory-repository.ts`
- Modify: `src/storage/redis-hitl-repository.ts`
- Modify: `tests/integration/e2e-pending-to-answered.test.ts`
- Create: `tests/integration/http-timeout-auto-response.test.ts`

- [ ] **Step 1: Write the failing response-shape tests**

```ts
it('includes timeout metadata on resolved questions after auto-response', async () => {
  process.env.HITL_STORAGE = 'redis';
  process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '1';
  process.env.HITL_PENDING_TIMEOUT_POLL_INTERVAL_SECONDS = '1';

  const { app, service } = await createRuntime();
  const caller = {
    agent_identity: 'api_key:test-agent',
    agent_session_id: 'session-http-timeout'
  };

  const created = await service.askQuestions({
    caller,
    input: {
      title: 'Need approval',
      questions: [{ type: 'text', title: 'Why?' }]
    }
  });

  const questionId = String(created[0].question_id);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const res = await app.request(`/api/v1/questions/${questionId}`, {
    headers: {
      'x-agent-identity': caller.agent_identity,
      'x-agent-session-id': caller.agent_session_id
    }
  });
  const payload = await res.json();

  expect(payload.data).toEqual(
    expect.objectContaining({
      question_id: questionId,
      default_answer: { value: 'none' },
      is_timeout_auto_response: true
    })
  );
});
```

- [ ] **Step 2: Run the response-shape tests to verify they fail**

Run: `npm test -- tests/integration/e2e-pending-to-answered.test.ts tests/integration/http-timeout-auto-response.test.ts`

Expected: FAIL because timeout metadata is not yet exposed consistently in snapshots and question fetches.

- [ ] **Step 3: Implement additive snapshot and question serialization**

```ts
// src/storage/in-memory-repository.ts / src/storage/redis-hitl-repository.ts
private resolvedQuestion(group: ScopedQuestionGroup, question: Record<string, unknown>) {
  return {
    question: this.publicQuestion(group, question),
    status: question.status as 'answered' | 'skipped' | 'cancelled',
    ...(Object.prototype.hasOwnProperty.call(question, 'answer') ? { answer: question.answer } : {})
  };
}

private publicQuestion(group: ScopedQuestionGroup, question: Record<string, unknown>) {
  return {
    ...question,
    group_id: undefined,
    status: (question.status as string | undefined) ?? 'pending',
    default_answer: question.default_answer,
    auto_response_at: question.auto_response_at,
    is_timeout_auto_response: question.is_timeout_auto_response
  };
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- tests/integration/e2e-pending-to-answered.test.ts tests/integration/http-timeout-auto-response.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/in-memory-repository.ts src/storage/redis-hitl-repository.ts tests/integration/e2e-pending-to-answered.test.ts tests/integration/http-timeout-auto-response.test.ts
git commit -m "feat: expose timeout metadata in question snapshots"
```

### Task 7: Update MCP Tool Guidance And Registration Tests

**Files:**
- Modify: `src/mcp/register-tools.ts`
- Modify: `src/mcp/tools/create-question-group.ts`
- Modify: `tests/integration/mcp-tools-registration.test.ts`
- Modify: `docs/api/mcp-tools.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing MCP guidance tests**

```ts
it('registers hitl_ask with timeout and default-answer guidance', async () => {
  process.env.HITL_PENDING_DEFAULT_TIMEOUT_SECONDS = '900';
  const runtime = await createRuntime();
  const hitlAsk = runtime.server.toolDefinitions.find((tool: any) => tool.name === 'hitl_ask');

  expect(hitlAsk.description).toContain('default_answer');
  expect(hitlAsk.description).toContain('900 seconds');
});
```

- [ ] **Step 2: Run the MCP registration test to verify it fails**

Run: `npm test -- tests/integration/mcp-tools-registration.test.ts`

Expected: FAIL because the tool description does not include timeout/default-answer guidance.

- [ ] **Step 3: Implement configurable tool description wiring**

```ts
// src/mcp/register-tools.ts
export function registerHitlTools(
  server: MCPServer,
  service: HitlService,
  logger: Logger,
  options: { defaultTimeoutSeconds: number }
) {
  registerAskTool(server, service, logger, options);
  // existing registrations unchanged
}
```

```ts
// src/mcp/tools/create-question-group.ts
const description =
  `Create one or more pending questions for the current caller scope. ` +
  `Prefer setting explicit default_answer values when possible. ` +
  `If omitted, the server derives a default answer per question type. ` +
  `The current default timeout is ${options.defaultTimeoutSeconds} seconds unless timeout_seconds is provided.`;
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- tests/integration/mcp-tools-registration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register-tools.ts src/mcp/tools/create-question-group.ts tests/integration/mcp-tools-registration.test.ts docs/api/mcp-tools.md README.md
git commit -m "feat: document timeout defaults in mcp tool guidance"
```

### Task 8: Run Full Verification And Clean Up

**Files:**
- No new source files expected
- Update only if verification exposes defects

- [ ] **Step 1: Run the targeted timeout test set**

Run: `npm test -- tests/unit/config-loader.test.ts tests/unit/domain-schemas.test.ts tests/unit/default-answer.test.ts tests/unit/in-memory-repository.test.ts tests/unit/redis-repository.test.ts tests/integration/wait-modes.test.ts tests/integration/redis-timeout-worker.test.ts tests/integration/http-timeout-auto-response.test.ts tests/integration/mcp-tools-registration.test.ts`

Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS with no regressions in existing question flows, idempotency, readiness, and MCP registration.

- [ ] **Step 3: Fix any failures with minimal follow-up edits**

```ts
// Example cleanup shape only if a regression appears:
if (result.changed_question_ids.length === 0 && snapshot.is_complete) {
  return {
    status: 'completed',
    is_terminal: true,
    ...snapshot
  };
}
```

- [ ] **Step 4: Re-run the failed test subset and then the full suite**

Run: `npm test -- <failed-test-paths>`  
Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit the final integrated change**

```bash
git add src tests docs
git commit -m "feat: add redis timeout auto responses"
```

## Self-Review

### Spec coverage

- Configurable default timeout: covered in Task 1 and Task 5.
- Configurable polling interval defaulting to 5 seconds: covered in Task 1 and Task 5.
- Per-question default answers and derived fallbacks: covered in Task 2 and Task 3.
- Redis-only timeout execution: covered in Task 4 and Task 5.
- Timeout metadata in responses: covered in Task 4 and Task 6.
- Non-breaking MCP/HTTP compatibility: preserved across Tasks 1, 3, 6, and 7.
- MCP guidance about explicit defaults and current timeout: covered in Task 7.
- Multi-instance lock safety: covered in Task 4 and Task 5 tests.

### Placeholder scan

- All tasks list exact files.
- All command steps include exact commands.
- Each code-writing step includes concrete snippet shape.
- No `TODO`/`TBD` placeholders remain.

### Type consistency

- `timeout_seconds`, `default_answer`, `defaultTimeoutSeconds`, and `timeoutPollIntervalSeconds` use consistent names throughout.
- Timeout metadata uses `auto_response_at` and `is_timeout_auto_response` consistently.
- Repository timeout processing is consistently named `processTimedOutGroups`.
