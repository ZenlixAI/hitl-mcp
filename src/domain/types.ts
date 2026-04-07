import type { z } from 'zod';
import type { askQuestionGroupInputSchema, createQuestionGroupInputSchema, questionSchema } from './schemas';

export type Question = z.infer<typeof questionSchema>;
export type QuestionGroupInput = z.infer<typeof askQuestionGroupInputSchema>;
export type CreateQuestionGroupInput = z.infer<typeof createQuestionGroupInputSchema>;

export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

export type CallerScope = {
  agent_identity: string;
  agent_session_id: string;
};

export type ScopedQuestionGroup = CallerScope & {
  question_group_id: string;
  title: string;
  description?: string;
  questions: Array<Record<string, any>>;
  status: GroupStatus;
  created_at: string;
  updated_at: string;
  answers?: Record<string, unknown>;
  skipped_question_ids?: string[];
  idempotency_key?: string;
  extra?: Record<string, unknown>;
};
