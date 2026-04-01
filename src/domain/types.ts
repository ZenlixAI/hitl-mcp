import type { z } from 'zod';
import type { askQuestionGroupInputSchema, questionSchema } from './schemas';

export type Question = z.infer<typeof questionSchema>;
export type QuestionGroupInput = z.infer<typeof askQuestionGroupInputSchema>;

export type GroupStatus = 'pending' | 'answered' | 'cancelled' | 'expired';
