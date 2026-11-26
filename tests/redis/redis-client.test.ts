import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  connectRedis,
  disconnectRedis,
  redisClient,
} from "../../src/redis/redis-client.js";

describe("Redis Connection Lifecycle", () => {
  afterEach(async () => {
    await disconnectRedis();
  });

  it("connects to Redis and accepts commands", async () => {
    await connectRedis();

    assert.equal(redisClient.isOpen, true);
    assert.equal(redisClient.isReady, true);
    assert.equal(await redisClient.ping(), "PONG");
  });

  it("allows connectRedis to be called multiple times", async () => {
    await connectRedis();
    await connectRedis();
    await connectRedis();

    assert.equal(redisClient.isOpen, true);
    assert.equal(redisClient.isReady, true);
    assert.equal(await redisClient.ping(), "PONG");
  });

  it("closes the Redis connection", async () => {
    await connectRedis();

    assert.equal(redisClient.isOpen, true);

    await disconnectRedis();

    assert.equal(redisClient.isOpen, false);
    assert.equal(redisClient.isReady, false);
  });

  it("allows disconnectRedis to be called multiple times", async () => {
    await connectRedis();

    await disconnectRedis();
    await disconnectRedis();
    await disconnectRedis();

    assert.equal(redisClient.isOpen, false);
    assert.equal(redisClient.isReady, false);
  });

  it("reconnects after disconnecting", async () => {
    await connectRedis();
    await disconnectRedis();

    assert.equal(redisClient.isOpen, false);

    await connectRedis();

    assert.equal(redisClient.isOpen, true);
    assert.equal(redisClient.isReady, true);
    assert.equal(await redisClient.ping(), "PONG");
  });
});
