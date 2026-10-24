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
  it("allows requests again after the rate-limit window expires", async () => {
    const expiryKey = `${key}:expiry`;
    await redisClient.del(expiryKey);

    try {
      const options = {
        limit: 1,
        windowSeconds: 2,
      };

      const firstRequest = await checkRateLimit(expiryKey, options);

      assert.equal(firstRequest.allowed, true);
      assert.equal(firstRequest.remaining, 0);
      assert.ok(firstRequest.retryAfterSeconds > 0);

      const blockedRequest = await checkRateLimit(expiryKey, options);

      assert.equal(blockedRequest.allowed, false);
      assert.equal(blockedRequest.remaining, 0);

      await new Promise((resolve) => setTimeout(resolve, 2200));

      const requestAfterExpiry = await checkRateLimit(expiryKey, options);

      assert.equal(requestAfterExpiry.allowed, true);
      assert.equal(requestAfterExpiry.remaining, 0);
      assert.ok(requestAfterExpiry.retryAfterSeconds > 0);
    } finally {
      await redisClient.del(expiryKey);
    }
  });
  it("enforces the limit for concurrent requests", async () => {
    const concurrentKey = `${key}:concurrent`;

    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          checkRateLimit(concurrentKey, {
            limit: 3,
            windowSeconds: 60,
          }),
        ),
      );

      assert.equal(results.filter((result) => result.allowed).length, 3);
    } finally {
      await redisClient.del(concurrentKey);
    }
  });
});
