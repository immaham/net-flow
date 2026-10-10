import { connectRedis, redisClient } from "./redis-client.js";
import { checkRateLimit } from "./rate-limiter.js";

async function main() {
  const key = "rate-limit:test-user";

  try {
    await connectRedis();
    await redisClient.del(key);

    for (let i = 1; i <= 7; i++) {
      const result = await checkRateLimit(key, {
        limit: 5,
        windowSeconds: 60,
      });

      console.log(`Request ${i}:`, result);
    }
  } catch (error) {
    console.error("Rate limiter test failed:", error);
    process.exitCode = 1;
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

main();
