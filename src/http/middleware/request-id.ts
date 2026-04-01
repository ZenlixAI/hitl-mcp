import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  c.set('requestId', requestId);
  await next();
};
