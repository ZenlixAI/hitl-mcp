import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('repository selection', () => {
  it('falls back to memory repository when redis is unavailable', async () => {
    process.env.HITL_STORAGE = 'redis';
    process.env.HITL_REDIS_URL = 'redis://127.0.0.1:6399';
    try {
      const runtime = await createRuntime();

      const created = await runtime.repository.createPendingGroup({
        agent_identity: 'api_key:test',
        agent_session_id: 'session-test',
        title: 'group',
        questions: [{ question_id: 'q_sel_1', type: 'text', title: 'why' }]
      });

      const group = await runtime.repository.getGroup(created.question_group_id);
      expect(group?.question_group_id).toBe(created.question_group_id);
    } finally {
      delete process.env.HITL_STORAGE;
      delete process.env.HITL_REDIS_URL;
    }
  });
});
