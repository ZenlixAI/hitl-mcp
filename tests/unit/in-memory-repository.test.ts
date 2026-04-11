import { describe, expect, it } from 'vitest';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository.js';

describe('in-memory repository scoped create', () => {
  it('returns the same pending group for matching create idempotency key', async () => {
    const repository = new InMemoryHitlRepository();

    const first = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ title: 'Approve?', type: 'boolean' }]
    });

    const second = await repository.createPendingGroup({
      agent_identity: 'api_key:a1',
      agent_session_id: 'session-1',
      title: 'Deploy approval',
      idempotency_key: 'create-1',
      questions: [{ title: 'Approve?', type: 'boolean' }]
    });

    expect(first.question_group_id).toMatch(/^qg_/);
    expect(second.question_group_id).toBe(first.question_group_id);
    expect(String(first.questions[0].question_id)).toMatch(/^q_/);
  });

  it('looks up the current pending group by caller scope', async () => {
    const repository = new InMemoryHitlRepository();

    const created = await repository.createPendingGroup({
      agent_identity: 'api_key:a2',
      agent_session_id: 'session-2',
      title: 'Approval',
      questions: [{ title: 'Ship?', type: 'boolean' }]
    });

    const current = await repository.getPendingGroupByScope('api_key:a2', 'session-2');

    expect(current?.question_group_id).toBe(created.question_group_id);
    expect(current?.status).toBe('pending');
  });

  it('supports multiple pending groups and accumulates partial submissions', async () => {
    const repository = new InMemoryHitlRepository();
    const caller = {
      agent_identity: 'api_key:a3',
      agent_session_id: 'session-3'
    };

    await repository.createPendingGroup({
      ...caller,
      title: 'First',
      questions: [{ title: 'One?', type: 'boolean' }]
    });
    await repository.createPendingGroup({
      ...caller,
      title: 'Second',
      questions: [{ title: 'Two?', type: 'boolean' }]
    });

    const before = await repository.getPendingQuestionsByScope(caller.agent_identity, caller.agent_session_id);
    expect(before).toHaveLength(2);
    expect(before.every((item) => String(item.question_id).startsWith('q_'))).toBe(true);
    const firstQuestionId = String(before[0].question_id);
    const secondQuestionId = String(before[1].question_id);

    const result = await repository.submitAnswers(caller, { [firstQuestionId]: { value: true } });
    expect(result.status).toBe('in_progress');

    const after = await repository.getPendingQuestionsByScope(caller.agent_identity, caller.agent_session_id);
    expect(after).toHaveLength(1);
    expect(String(after[0].question_id)).toBe(secondQuestionId);
  });
});
