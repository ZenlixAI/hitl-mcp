import { z } from 'zod';

export const appConfigSchema = z.object({
  server: z.object({
    name: z.string(),
    version: z.string(),
    baseUrl: z.string()
  }),
  http: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    apiPrefix: z.string()
  }),
  storage: z.object({
    kind: z.enum(['memory', 'redis'])
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
    apiKey: z.string().min(1).optional()
  }),
  agentIdentity: z.object({
    authMode: z.enum(['api_key', 'bearer']),
    sessionHeader: z.string().min(1),
    createConflictPolicy: z.enum(['error', 'reuse_pending'])
  }),
  observability: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
    enableMetrics: z.boolean()
  })
});

export type AppConfig = z.infer<typeof appConfigSchema>;
