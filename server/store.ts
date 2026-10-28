import { Redis } from '@upstash/redis';
import { required } from './config.js';

export function db() {
  return new Redis({ url: process.env.UPSTASH_REDIS_REST_URL || required('KV_REST_API_URL'), token: process.env.UPSTASH_REDIS_REST_TOKEN || required('KV_REST_API_TOKEN') });
}

export async function rateLimit(key: string, limit: number, seconds: number) {
  const count = await db().eval<unknown[], number>(
    "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
    [`rvm:rate:${key}`], [seconds],
  );
  return count <= limit;
}
