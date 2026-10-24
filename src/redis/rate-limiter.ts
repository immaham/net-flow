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

const RATE_LIMIT_SCRIPT = `
local currentCount = redis.call("INCR", KEYS[1])

if currentCount == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end

local ttl = redis.call("TTL", KEYS[1])

return { currentCount, ttl }
`;

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = options;

  const result = (await redisClient.eval(RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [String(windowSeconds)],
  })) as [number, number];

  const [currentCount, ttl] = result;

  return {
    allowed: currentCount <= limit,
    limit,
    remaining: Math.max(0, limit - currentCount),
    retryAfterSeconds: Math.max(0, ttl),
  };
}
