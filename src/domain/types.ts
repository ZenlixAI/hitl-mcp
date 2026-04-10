import type { z } from 'zod';
import type { askQuestionSchema, askQuestionsInputSchema, questionSchema, submitAnswersInputSchema } from './schemas';

export type Question = z.infer<typeof questionSchema>;
export type AskQuestion = z.infer<typeof askQuestionSchema>;
export type AskQuestionsInput = z.infer<typeof askQuestionsInputSchema>;
export type SubmitAnswersInput = z.infer<typeof submitAnswersInputSchema>;

export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';
export type PublicQuestionStatus = 'pending' | 'answered' | 'skipped' | 'cancelled';

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

export type ScopeQuestionSnapshot = {
  pending_questions: Array<Record<string, unknown>>;
  resolved_questions: Array<{
    question: Record<string, unknown>;
    status: PublicQuestionStatus;
    answer?: unknown;
  }>;
  answered_question_ids: string[];
  skipped_question_ids: string[];
  cancelled_question_ids: string[];
  changed_question_ids: string[];
  is_complete: boolean;
};
