import type { Context, MiddlewareHandler } from 'hono';
import { fail } from '../response';

export function resolveApiKeyPrincipal(c: Context, expectedApiKey: string): string | null {
  const provided = c.req.header('x-api-key');
  if (provided !== expectedApiKey) return null;
  return `api_key:${provided}`;
}

export function apiKeyAuth(expectedApiKey: string): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.get('requestId') ?? 'local';
    const principal = resolveApiKeyPrincipal(c, expectedApiKey);
    if (!principal) {
      return c.json(
        fail(requestId, 'UNAUTHORIZED', 'invalid api key'),
        401
      );
    }

    c.set('agentIdentity', principal);
    await next();
  };
}
