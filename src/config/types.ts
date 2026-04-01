import { z } from 'zod';

export const appConfigSchema = z.object({
  http: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    apiPrefix: z.string()
  }),
  redis: z.object({
    url: z.string(),
    keyPrefix: z.string()
  }),
  ttl: z.object({
    defaultSeconds: z.number().int().positive(),
    answeredRetentionSeconds: z.number().int().positive()
  }),
  pending: z.object({
    maxWaitSeconds: z.number().int().nonnegative()
  }),
  security: z.object({
    apiKey: z.string().min(1)
  })
});

export type AppConfig = z.infer<typeof appConfigSchema>;
