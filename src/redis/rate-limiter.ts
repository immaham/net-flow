import { redisClient } from "./redis-client.js";

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;

  const currentCount = await redisClient.incr(key);

  if (currentCount === 1) {
    await redisClient.expire(key, windowSeconds);
  }

  const ttl = await redisClient.ttl(key);

  return {
    allowed: currentCount <= limit,
    limit,
    remaining: Math.max(0, limit - currentCount),
    retryAfterSeconds: Math.max(0, ttl),
  };
}
