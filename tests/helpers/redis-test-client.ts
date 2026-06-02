import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';

type AnyRedis = Redis | RedisMock;

export type RedisTestContext = {
  clients: AnyRedis[];
  prefix: string;
  usingRealRedis: boolean;
  createClient: () => AnyRedis;
  cleanup: () => Promise<void>;
};

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

function buildPrefix(base = 'hitl-test') {
  return `${base}:${randomUUID()}`;
}

async function deleteByPrefix(client: AnyRedis, prefix: string) {
  if (client instanceof RedisMock) return;

  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } while (cursor !== '0');
}

async function safeClose(client: AnyRedis) {
  try {
    if (!(client instanceof RedisMock)) {
      try {
        await client.unsubscribe();
      } catch {}
    }
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export function createRedisTestContext(basePrefix = 'hitl-test'): RedisTestContext {
  const clients: AnyRedis[] = [];
  const prefix = buildPrefix(basePrefix);
  const usingRealRedis = Boolean(TEST_REDIS_URL);

  const createClient = () => {
    const client = TEST_REDIS_URL ? new Redis(TEST_REDIS_URL) : new RedisMock();
    clients.push(client);
    return client;
  };

  return {
    clients,
    prefix,
    usingRealRedis,
    createClient,
    cleanup: async () => {
      if (TEST_REDIS_URL) {
        const cleanupClient = new Redis(TEST_REDIS_URL);
        try {
          await deleteByPrefix(cleanupClient, prefix);
        } finally {
          await safeClose(cleanupClient);
        }
      }

      await Promise.all(clients.map((client) => safeClose(client)));
    }
  };
}
