import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/server/create-server';

describe('repository selection', () => {
  it('falls back to memory repository when redis is unavailable', async () => {
    process.env.HITL_STORAGE = 'redis';
    process.env.HITL_REDIS_URL = 'redis://127.0.0.1:6399';
    try {
      const runtime = await createRuntime();

      await runtime.repository.createPendingGroup({
        question_group_id: 'qg_sel_1',
        title: 'group',
        questions: [{ question_id: 'q_sel_1', type: 'text', title: 'why' }]
      });

      const group = await runtime.repository.getGroup('qg_sel_1');
      expect(group?.question_group_id).toBe('qg_sel_1');
    } finally {
      delete process.env.HITL_STORAGE;
      delete process.env.HITL_REDIS_URL;
    }
  });
});
