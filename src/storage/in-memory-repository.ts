import { transitionStatus } from '../state/status-machine';
import type { HitlRepository, FinalizeResult } from './hitl-repository';

type GroupRecord = {
  question_group_id: string;
  title: string;
  questions: Array<any>;
  status: 'pending' | 'answered' | 'cancelled' | 'expired';
  answers?: Record<string, unknown>;
  updated_at: string;
};

export class InMemoryHitlRepository implements HitlRepository {
  private groups = new Map<string, GroupRecord>();
  private finalizeIdempotency = new Map<string, FinalizeResult>();

  async isReady(): Promise<boolean> {
    return true;
  }

  async createPendingGroup(input: any): Promise<void> {
    const now = new Date().toISOString();
    this.groups.set(input.question_group_id, {
      question_group_id: input.question_group_id,
      title: input.title,
      questions: input.questions,
      status: 'pending',
      updated_at: now
    });
  }

  async getGroup(groupId: string): Promise<Record<string, unknown> | null> {
    return this.groups.get(groupId) ?? null;
  }

  async getQuestion(questionId: string): Promise<Record<string, unknown> | null> {
    for (const group of this.groups.values()) {
      const question = group.questions.find((q) => q.question_id === questionId);
      if (question) return question;
    }
    return null;
  }

  async getGroupStatus(groupId: string): Promise<Record<string, unknown> | null> {
    const group = this.groups.get(groupId);
    if (!group) return null;
    return {
      question_group_id: group.question_group_id,
      status: group.status,
      updated_at: group.updated_at
    };
  }

  async finalizeAnswers(
    groupId: string,
    answers: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<FinalizeResult> {
    if (idempotencyKey) {
      const cached = this.finalizeIdempotency.get(idempotencyKey);
      if (cached) return cached;
    }

    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'answered');

    const answeredAt = new Date().toISOString();
    group.status = 'answered';
    group.answers = answers;
    group.updated_at = answeredAt;

    const result = {
      status: 'answered',
      answered_question_ids: Object.keys(answers),
      answered_at: answeredAt
    };

    if (idempotencyKey) {
      this.finalizeIdempotency.set(idempotencyKey, result);
    }

    return result;
  }

  async cancelGroup(groupId: string, reason?: string): Promise<{ status: 'cancelled'; reason?: string }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'cancelled');
    group.status = 'cancelled';
    group.updated_at = new Date().toISOString();
    return { status: 'cancelled', reason };
  }

  async expireGroup(groupId: string, reason?: string): Promise<{ status: 'expired'; reason?: string }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('QUESTION_GROUP_NOT_FOUND');
    transitionStatus(group.status, 'expired');
    group.status = 'expired';
    group.updated_at = new Date().toISOString();
    return { status: 'expired', reason };
  }
}
