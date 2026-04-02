import { describe, expect, it } from 'vitest';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository';

describe('in-memory repository scoped create', () => {
  it('returns the same pending group for matching create idempotency key', async () => {
    const repository = new InMemoryHitlRepository();

    const first = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    const second = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ question_id: 'q1', title: 'Approve?', type: 'boolean' }]
    });

    expect(first.question_group_id).toMatch(/^qg_/);
    expect(second.question_group_id).toBe(first.question_group_id);
  });

  it('looks up the current pending group by caller scope', async () => {
    const repository = new InMemoryHitlRepository();

    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a2',
      agent_session_id: 'session-2',
      title: 'Approval',
      questions: [{ question_id: 'q2', title: 'Ship?', type: 'boolean' }]
    });

    const current = await repository.getPendingGroupByScope('api_key:a2', 'session-2');

    expect(current?.question_group_id).toBe(created.question_group_id);
    expect(current?.status).toBe('pending');
  });
});
