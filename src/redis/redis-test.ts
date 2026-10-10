import { connectRedis, redisClient } from "./redis-client.js";

async function main() {
  try {
    await connectRedis();

    await redisClient.set("net-flow:test", "Redis is working");

    const value = await redisClient.get("net-flow:test");

    console.log("Redis test result:", value);
  } catch (error) {
    console.error("Redis test failed:", error);
    process.exitCode = 1;
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

main();
