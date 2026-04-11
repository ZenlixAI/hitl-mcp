import { Redis } from 'ioredis';

export type RedisClient = InstanceType<typeof Redis>;

export function createRedisClient(redisUrl: string) {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 500
  });

  // Repository selection may probe and fallback; swallow connection probe noise.
  redis.on('error', () => {});

  return redis;
}
