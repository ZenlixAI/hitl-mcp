import { describe, expect, it } from 'vitest';
import { HitlService } from '../../src/core/hitl-service.js';
import type { CallerScope, ScopeQuestionSnapshot } from '../../src/domain/types.js';
import { InMemoryHitlRepository } from '../../src/storage/in-memory-repository.js';
import type { HitlRepository } from '../../src/storage/hitl-repository.js';
import { Waiter } from '../../src/state/waiter.js';

const caller: CallerScope = {
  agent_identity: 'api_key:test-agent',
  agent_session_id: 'session-wait-race'
};

function waitForOutcome<T>(promise: Promise<T>, ms = 50) {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))
  ]);
}

describe('wait race conditions', () => {
  it('does not miss a notify that lands between snapshot read and waiter registration', async () => {
    const repository = new InMemoryHitlRepository();
    const waiter = new Waiter();

    const created = await repository.createPendingGroup({
      ...caller,
      title: 'Race window',
      questions: [{ type: 'boolean', title: 'Continue?' }]
    });
    const questionId = String(created.questions[0].question_id);
    const scopeKey = `${caller.agent_identity}::${caller.agent_session_id}`;

    let firstSnapshot = true;
    const snapshotPending: ScopeQuestionSnapshot = {
      pending_questions: [
        {
          ...created.questions[0],
          group_id: undefined
        }
      ],
      resolved_questions: [],
      answered_question_ids: [],
      skipped_question_ids: [],
      cancelled_question_ids: [],
      changed_question_ids: [],
      is_complete: false
    };

    const repositoryWithRace: HitlRepository = {
      ...repository,
      async getScopeSnapshot(scopeCaller, changedQuestionIds = []) {
        if (!firstSnapshot) {
          return repository.getScopeSnapshot(scopeCaller, changedQuestionIds);
        }

        firstSnapshot = false;
        await repository.submitAnswers(scopeCaller, {
          [questionId]: { value: true }
        });
        const completedSnapshot = await repository.getScopeSnapshot(scopeCaller, [questionId]);
        waiter.notify(scopeKey, completedSnapshot);
        return snapshotPending;
      }
    };

    const service = new HitlService(repositoryWithRace, waiter, 0, 'terminal_only');

    const waitPromise = service.wait({ caller });
    const outcome = await waitForOutcome(waitPromise);

    expect(outcome).toBe('resolved');
    await expect(waitPromise).resolves.toMatchObject({
      status: 'completed',
      is_terminal: true,
      answered_question_ids: [questionId]
    });
  });

  it('wakes every concurrent wait on the same caller scope', async () => {
    const repository = new InMemoryHitlRepository();
    const waiter = new Waiter();
    const service = new HitlService(repository, waiter, 0, 'terminal_only');

    const created = await service.askQuestions({
      caller,
      input: {
        title: 'Concurrent wait',
        questions: [{ type: 'boolean', title: 'Approve?' }]
      }
    });
    const questionId = String(created[0].question_id);

    const firstWait = service.wait({ caller });
    const secondWait = service.wait({ caller });

    await service.submitAnswers({
      caller,
      input: {
        answers: {
          [questionId]: { value: true }
        }
      }
    });

    const firstOutcome = await waitForOutcome(firstWait);
    const secondOutcome = await waitForOutcome(secondWait);

    expect(firstOutcome).toBe('resolved');
    expect(secondOutcome).toBe('resolved');
    await expect(firstWait).resolves.toMatchObject({ status: 'completed', is_terminal: true });
    await expect(secondWait).resolves.toMatchObject({ status: 'completed', is_terminal: true });
  });
});
