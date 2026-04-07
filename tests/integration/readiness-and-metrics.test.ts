import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('readiness and metrics', () => {
  it('exposes readyz and metrics with counters', async () => {
    const runtime = await createRuntime();

    const ready = await runtime.app.request('/api/v1/readyz');
    expect(ready.status).toBe(200);

    await runtime.repository.createPendingGroup({
      agent_identity: 'api_key:test-agent',
      agent_session_id: 'session-metrics-1',
      title: 'group',
      questions: [
        {
          question_id: 'q_range_1',
          type: 'range',
          title: 'score',
          range_constraints: { min: 0, max: 10, step: 1 }
        }
      ]
    });

    const finalize = await runtime.app.request('/api/v1/questions/answers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-identity': 'api_key:test-agent',
        'x-agent-session-id': 'session-metrics-1'
      },
      body: JSON.stringify({ answers: { q_range_1: { value: 99 } } })
    });

    expect(finalize.status).toBe(422);

    const metricsRes = await runtime.app.request('/api/v1/metrics');
    expect(metricsRes.status).toBe(200);
    const metricsBody = await metricsRes.json();
    expect(metricsBody.data.counters.finalize_validation_failed_total).toBeGreaterThanOrEqual(1);
  });
});
