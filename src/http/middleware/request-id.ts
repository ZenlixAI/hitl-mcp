import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? randomUUID();
  const traceId = c.req.header('x-trace-id') ?? requestId;
  c.set('requestId', requestId);
  c.set('traceId', traceId);
  await next();
  c.res.headers.set('x-request-id', requestId);
  c.res.headers.set('x-trace-id', traceId);
};
