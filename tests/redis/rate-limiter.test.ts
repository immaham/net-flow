import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectRedis, redisClient } from "../../src/redis/redis-client.js";
import { checkRateLimit } from "../../src/redis/rate-limiter.js";

describe("Rate Limiter integration", () => {
  const key = `rate-limit:test:${process.pid}`;

  before(async () => {
    await connectRedis();
    await redisClient.del(key);
  });

  after(async () => {
    await redisClient.del(key);
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  it("allows requests up to the configured limit", async () => {
    for (let i = 1; i <= 5; i++) {
      const result = await checkRateLimit(key, {
        limit: 5,
        windowSeconds: 60,
      });

      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i);
      assert.equal(result.limit, 5);
      assert.ok(result.retryAfterSeconds > 0);
    }
  });

  it("rejects requests beyond the configured limit", async () => {
    const result = await checkRateLimit(key, {
      limit: 5,
      windowSeconds: 60,
    });

    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.ok(result.retryAfterSeconds > 0);
  });
});
