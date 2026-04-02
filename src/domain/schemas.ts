import { z } from 'zod';

const commonQuestionSchema = {
  question_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  required: z.boolean().default(true)
};

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional()
});

const singleChoiceQuestionSchema = z.object({
  ...commonQuestionSchema,
  type: z.literal('single_choice'),
  options: z.array(optionSchema).min(1)
});

const multiChoiceQuestionSchema = z.object({
  ...commonQuestionSchema,
  type: z.literal('multi_choice'),
  options: z.array(optionSchema).min(1)
});

const textQuestionSchema = z.object({
  ...commonQuestionSchema,
  type: z.literal('text'),
  text_constraints: z
    .object({
      min_length: z.number().int().min(0).optional(),
      max_length: z.number().int().positive().optional(),
      pattern: z.string().optional()
    })
    .optional()
});

const booleanQuestionSchema = z.object({
  ...commonQuestionSchema,
  type: z.literal('boolean')
});

const rangeQuestionSchema = z.object({
  ...commonQuestionSchema,
  type: z.literal('range'),
  range_constraints: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional()
  })
});

export const questionSchema = z.discriminatedUnion('type', [
  singleChoiceQuestionSchema,
  multiChoiceQuestionSchema,
  textQuestionSchema,
  booleanQuestionSchema,
  rangeQuestionSchema
]);

export const askQuestionGroupInputSchema = z.object({
  question_group_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.any()).optional(),
  ttl_seconds: z.number().int().positive().optional(),
  questions: z.array(questionSchema).min(1),
  idempotency_key: z.string().optional(),
  metadata: z
    .object({
      agent_session_id: z.string().optional(),
      agent_trace_id: z.string().optional()
    })
    .optional()
});

export const finalizeAnswersSchema = z.object({
  idempotency_key: z.string().optional(),
  answers: z.record(z.string(), z.object({ value: z.any() })),
  finalized_by: z.string().optional(),
  extra: z.record(z.string(), z.any()).optional()
});
