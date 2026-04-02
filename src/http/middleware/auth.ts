import type { MiddlewareHandler } from 'hono';
import { fail } from '../response';

export function apiKeyAuth(expectedApiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') ?? 'local';
    const provided = c.req.header('x-api-key');

    if (provided !== expectedApiKey) {
      return c.json(
        fail(requestId, 'UNAUTHORIZED', 'invalid api key'),
        401
      );
    }

    await next();
  };
}
