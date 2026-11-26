import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";

import { checkBackendHealth } from "../../src/health/health-checker.js";
import type { Backend } from "../../src/load-balancer/index.js";

function createBackend(port: number): Backend {
  return {
    name: "test-backend",
    host: "127.0.0.1",
    port,
    healthy: true,
    activeConnections: 0,
  };
}

async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");

  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  return address.port;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

describe("Health Checker integration", () => {
  it("returns true when the backend responds with HTTP 200", async () => {
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n",
        );
      });
    });

    const port = await listen(server);

    try {
      const healthy = await checkBackendHealth(createBackend(port));

      assert.equal(healthy, true);
    } finally {
      await closeServer(server);
    }
  });

  it("returns false when the backend responds with HTTP 503", async () => {
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 503 Service Unavailable\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n",
        );
      });
    });

    const port = await listen(server);

    try {
      const healthy = await checkBackendHealth(createBackend(port));

      assert.equal(healthy, false);
    } finally {
      await closeServer(server);
    }
  });

  it("returns false when the backend is unavailable", async () => {
    const server = net.createServer();
    const port = await listen(server);

    await closeServer(server);

    const healthy = await checkBackendHealth(createBackend(port));

    assert.equal(healthy, false);
  });

  it(
    "returns false and closes the socket when the backend never responds",
    {
      timeout: 5000,
    },
    async () => {
      let backendSocket: net.Socket | undefined;

      let backendClosedResolve!: () => void;

      const backendClosed = new Promise<void>((resolve) => {
        backendClosedResolve = resolve;
      });

      const server = net.createServer((socket) => {
        backendSocket = socket;

        socket.once("close", backendClosedResolve);

        socket.resume();
      });

      const port = await listen(server);

      try {
        const healthy = await checkBackendHealth(createBackend(port));

        assert.equal(healthy, false);

        await backendClosed;

        assert.ok(backendSocket?.destroyed);
      } finally {
        backendSocket?.destroy();

        await closeServer(server);
      }
    },
  );
});
