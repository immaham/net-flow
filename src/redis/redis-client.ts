import { createClient } from "redis";

const redisClient = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
});

redisClient.on("error", (error) => {
  console.error("Redis Client Error:", error);
});

export async function connectRedis() {
  if (redisClient.isOpen) {
    return;
  }

  await redisClient.connect();
  console.log("Connected to Redis");
}

export { redisClient };
