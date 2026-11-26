import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";

import { startHealthChecks } from "../../src/health/health-checker.js";
import type { Backend } from "../../src/load-balancer/index.js";

async function createTestBackend(responseDelay = 0) {
  let requestCount = 0;
  let activeChecks = 0;
  let maxConcurrentChecks = 0;

  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);

    socket.once("close", () => {
      sockets.delete(socket);
    });

    socket.once("data", async () => {
      requestCount++;
      activeChecks++;

      maxConcurrentChecks = Math.max(maxConcurrentChecks, activeChecks);

      await delay(responseDelay);

      activeChecks--;

      if (!socket.destroyed) {
        socket.end(
          "HTTP/1.1 200 OK\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n",
        );
      }
    });
  });

  server.listen(0, "127.0.0.1");

  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  const backend: Backend = {
    name: "scheduler-test-backend",
    host: "127.0.0.1",
    port: address.port,
    healthy: false,
    activeConnections: 0,
  };

  return {
    backend,

    get requestCount() {
      return requestCount;
    },

    get activeChecks() {
      return activeChecks;
    },

    get maxConcurrentChecks() {
      return maxConcurrentChecks;
    },

    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition was not met before timeout");
    }

    await delay(5);
  }
}

describe("Health Check Scheduler", () => {
  it("runs the first health check immediately", async () => {
    const testBackend = await createTestBackend();

    const stop = startHealthChecks([testBackend.backend], 10000);

    try {
      await waitFor(() => testBackend.backend.healthy);

      assert.equal(testBackend.requestCount, 1);
    } finally {
      await stop();
      await testBackend.close();
    }
  });

  it("runs health checks periodically", async () => {
    const testBackend = await createTestBackend();

    const stop = startHealthChecks([testBackend.backend], 20);

    try {
      await waitFor(() => testBackend.requestCount >= 3);

      assert.ok(testBackend.requestCount >= 3);
    } finally {
      await stop();
      await testBackend.close();
    }
  });

  it("does not overlap health checks", async () => {
    const testBackend = await createTestBackend(80);

    const stop = startHealthChecks([testBackend.backend], 10);

    try {
      await waitFor(() => testBackend.requestCount >= 3);

      await stop();

      assert.equal(testBackend.maxConcurrentChecks, 1);
    } finally {
      await stop();
      await testBackend.close();
    }
  });

  it("stops scheduling new health checks", async () => {
    const testBackend = await createTestBackend();

    const stop = startHealthChecks([testBackend.backend], 20);

    try {
      await waitFor(() => testBackend.requestCount >= 2);

      await stop();

      const requestCount = testBackend.requestCount;

      await delay(100);

      assert.equal(testBackend.requestCount, requestCount);
    } finally {
      await stop();
      await testBackend.close();
    }
  });

  it("waits for an in-flight health check before stopping", async () => {
    const testBackend = await createTestBackend(100);

    const stop = startHealthChecks([testBackend.backend], 20);

    try {
      await waitFor(() => testBackend.activeChecks === 1);

      assert.equal(testBackend.backend.healthy, false);

      await stop();

      assert.equal(testBackend.activeChecks, 0);
      assert.equal(testBackend.backend.healthy, true);
      assert.equal(testBackend.requestCount, 1);
    } finally {
      await stop();
      await testBackend.close();
    }
  });

  it("allows the scheduler to be stopped multiple times", async () => {
    const testBackend = await createTestBackend();

    const stop = startHealthChecks([testBackend.backend], 20);

    try {
      await stop();
      await stop();
      await stop();

      const requestCount = testBackend.requestCount;

      await delay(100);

      assert.equal(testBackend.requestCount, requestCount);
    } finally {
      await stop();
      await testBackend.close();
    }
  });
});
