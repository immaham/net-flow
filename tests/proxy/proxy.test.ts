import net from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  proxyToBackend,
  writeWithBackpressure,
} from "../../src/proxy/proxy.js";
import type { Backend } from "../../src/load-balancer/types.js";
import { createRequestContext } from "../../src/observability/request-context.js";

async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  return address.port;
}

function createBackend(port: number, name: string): Backend {
  return {
    host: "127.0.0.1",
    port,
    name,
    activeConnections: 0,
    healthy: true,
  };
}

describe("writeWithBackpressure", () => {
  it("pauses the source when destination.write returns false", () => {
    let paused = false;

    const source = {
      pause() {
        paused = true;
      },
    } as net.Socket;

    const destination = {
      write() {
        return false;
      },
    } as net.Socket;

    const result = writeWithBackpressure(
      source,
      destination,
      Buffer.from("test"),
    );

    assert.equal(result, false);
    assert.equal(paused, true);
  });

  it("does not pause the source when destination.write returns true", () => {
    let paused = false;

    const source = {
      pause() {
        paused = true;
      },
    } as net.Socket;

    const destination = {
      write() {
        return true;
      },
    } as net.Socket;

    const result = writeWithBackpressure(
      source,
      destination,
      Buffer.from("test"),
    );

    assert.equal(result, true);
    assert.equal(paused, false);
  });
});

it("retries with the next backend when the first backend is unavailable", async () => {
  const backendServer = net.createServer((socket) => {
    socket.on("data", () => {
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
      );
    });
  });

  const backendPort = await listen(backendServer);
  const unavailableServer = net.createServer();
  const unavailablePort = await listen(unavailableServer);

  // Close the server so its port becomes unavailable.
  await new Promise<void>((resolve, reject) => {
    unavailableServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const unavailableBackend = createBackend(
    unavailablePort,
    "unavailable-backend",
  );
  const healthyBackend = createBackend(backendPort, "healthy-backend");

  const clientServer = net.createServer((clientSocket) => {
    proxyToBackend({
      clientSocket,
      backend: unavailableBackend,
      data: Buffer.from(
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      ),
      backends: [unavailableBackend, healthyBackend],
      context: createRequestContext(),
      rateLimitInfo: {
        allowed: true,
        limit: 100,
        remaining: 99,
        retryAfterSeconds: 60,
      },
    });
  });

  const proxyPort = await listen(clientServer);

  try {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(
        { host: "127.0.0.1", port: proxyPort },
        () => {
          socket.write(
            "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
          );
        },
      );

      const chunks: Buffer[] = [];

      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
      socket.on("error", reject);
    });

    assert.match(response, /200 OK/);
    assert.match(response, /\r\nX-RateLimit-Limit: 100\r\n/i);
    assert.match(response, /\r\nX-RateLimit-Remaining: 99\r\n/i);
    assert.match(response, /\r\n\r\nOK$/);
    assert.equal(unavailableBackend.activeConnections, 0);
    assert.equal(healthyBackend.activeConnections, 0);
  } finally {
    clientServer.close();
    backendServer.close();
  }
});

describe("Proxy integration", () => {
  it("does not modify HTTP 101 protocol-upgrade responses", async () => {
    const upgradeResponse =
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "\r\n";

    const backendSockets = new Set<net.Socket>();
    const backendServer = net.createServer((socket) => {
      backendSockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => backendSockets.delete(socket));

      socket.on("data", () => {
        socket.write(upgradeResponse);
        // Keep the connection open, as an upgraded connection would.
      });
    });

    const backendPort = await listen(backendServer);
    const backend = createBackend(backendPort, "upgrade-backend");

    const proxySockets = new Set<net.Socket>();
    const clientServer = net.createServer((clientSocket) => {
      proxySockets.add(clientSocket);
      clientSocket.on("close", () => proxySockets.delete(clientSocket));
      proxyToBackend({
        clientSocket,
        backend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n\r\n",
        ),
        backends: [backend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            socket.write(
              "GET / HTTP/1.1\r\n" +
                "Host: localhost\r\n" +
                "Connection: Upgrade\r\n" +
                "Upgrade: websocket\r\n\r\n",
            );
          },
        );

        const chunks: Buffer[] = [];
        let settled = false;

        socket.on("data", (chunk) => {
          chunks.push(chunk);

          const received = Buffer.concat(chunks).toString("latin1");

          if (received.includes("\r\n\r\n") && !settled) {
            settled = true;
            resolve(received);
          }
        });

        socket.on("error", (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      });

      assert.equal(response, upgradeResponse);
      assert.doesNotMatch(response, /X-RateLimit-Limit/i);
      assert.doesNotMatch(response, /X-RateLimit-Remaining/i);
      assert.equal(backend.activeConnections, 1);
    } finally {
      for (const socket of proxySockets) {
        socket.destroy();
      }

      for (const socket of backendSockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve) => {
        clientServer.close(() => resolve());
      });

      await new Promise<void>((resolve) => {
        backendServer.close(() => resolve());
      });
    }
  });

  it("forwards data bidirectionally after HTTP 101 upgrade", async () => {
    const upgradeResponse =
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "\r\n";

    const backendSockets = new Set<net.Socket>();
    let receivedClientData = "";

    const backendServer = net.createServer((socket) => {
      backendSockets.add(socket);
      socket.on("close", () => backendSockets.delete(socket));
      socket.on("error", () => {});

      socket.on("data", (chunk) => {
        const message = chunk.toString();

        if (message.startsWith("GET /")) {
          socket.write(upgradeResponse);
          return;
        }

        receivedClientData += message;
        socket.write(`echo:${message}`);
      });
    });

    const backendPort = await listen(backendServer);
    const backend = createBackend(backendPort, "bidirectional-backend");

    const proxySockets = new Set<net.Socket>();
    const clientServer = net.createServer((clientSocket) => {
      proxySockets.add(clientSocket);
      clientSocket.on("close", () => proxySockets.delete(clientSocket));

      proxyToBackend({
        clientSocket,
        backend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n\r\n",
        ),
        backends: [backend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);
    let testSocket: net.Socket | undefined;

    try {
      const response = await new Promise<string>((resolve, reject) => {
        testSocket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            testSocket!.write(
              "GET / HTTP/1.1\r\n" +
                "Host: localhost\r\n" +
                "Connection: Upgrade\r\n" +
                "Upgrade: websocket\r\n\r\n",
            );
          },
        );

        const socket = testSocket;
        const chunks: Buffer[] = [];
        let settled = false;

        socket.on("data", (chunk) => {
          chunks.push(chunk);

          const received = Buffer.concat(chunks).toString("latin1");

          if (received.includes("\r\n\r\n") && !settled) {
            settled = true;
            resolve(received);
          }
        });

        socket.on("error", (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      });

      assert.equal(response, upgradeResponse);

      const echoPromise = new Promise<string>((resolve, reject) => {
        const socket = testSocket!;
        let received = "";

        const onData = (chunk: Buffer) => {
          received += chunk.toString();

          if (received.includes("echo:ping")) {
            socket.off("data", onData);
            resolve(received);
          }
        };

        socket.on("data", onData);
        socket.once("error", reject);
        socket.write("ping");
      });

      assert.match(await echoPromise, /echo:ping/);
      assert.equal(receivedClientData, "ping");
      assert.equal(backend.activeConnections, 1);
    } finally {
      testSocket?.destroy();

      for (const socket of proxySockets) socket.destroy();
      for (const socket of backendSockets) socket.destroy();

      await new Promise<void>((resolve) => clientServer.close(() => resolve()));
      await new Promise<void>((resolve) =>
        backendServer.close(() => resolve()),
      );
    }
  });

  it("forwards a backend response to the client", async () => {
    const backendServer = net.createServer((socket) => {
      socket.on("data", () => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
      });
    });

    const backendPort = await listen(backendServer);
    const backend = createBackend(backendPort, "healthy-backend");

    const clientServer = net.createServer((clientSocket) => {
      proxyToBackend({
        clientSocket,
        backend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        ),
        backends: [backend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            socket.write(
              "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            );
          },
        );

        const chunks: Buffer[] = [];

        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
        socket.on("error", reject);
      });

      assert.match(response, /200 OK/);
      assert.match(response, /\r\n\r\nOK$/);
      assert.equal(backend.activeConnections, 0);
    } finally {
      clientServer.close();
      backendServer.close();
    }
  });

  it("adds rate-limit headers when backend response headers arrive in chunks", async () => {
    const backendServer = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n");
        setTimeout(() => {
          socket.end("\r\nOK");
        }, 10);
      });
    });

    const backendPort = await listen(backendServer);
    const backend = createBackend(backendPort, "chunked-headers-backend");

    const clientServer = net.createServer((clientSocket) => {
      proxyToBackend({
        clientSocket,
        backend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        ),
        backends: [backend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            socket.write(
              "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            );
          },
        );

        const chunks: Buffer[] = [];

        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
        socket.on("error", reject);
      });

      assert.match(response, /200 OK/);
      assert.match(response, /\r\nX-RateLimit-Limit: 100\r\n/i);
      assert.match(response, /\r\nX-RateLimit-Remaining: 99\r\n/i);
      assert.match(response, /\r\n\r\nOK$/);
      assert.equal(backend.activeConnections, 0);
    } finally {
      clientServer.close();
      backendServer.close();
    }
  });

  it("releases the backend connection when the client disconnects", async () => {
    let backendConnectedResolve!: () => void;
    const backendConnected = new Promise<void>((resolve) => {
      backendConnectedResolve = resolve;
    });

    const silentBackendServer = net.createServer(() => {
      backendConnectedResolve();
      // Intentionally keep the backend connection open without responding.
    });

    const backendPort = await listen(silentBackendServer);
    const backend = createBackend(backendPort, "silent-backend");

    const clientServer = net.createServer((clientSocket) => {
      clientSocket.once("data", (requestData) => {
        proxyToBackend({
          clientSocket,
          backend,
          data: requestData,
          backends: [backend],
          context: createRequestContext(),
          rateLimitInfo: {
            allowed: true,
            limit: 100,
            remaining: 99,
            retryAfterSeconds: 60,
          },
        });
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const clientSocket = net.createConnection({
        host: "127.0.0.1",
        port: proxyPort,
      });

      await once(clientSocket, "connect");

      clientSocket.write(
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      );

      await backendConnected;
      const clientClosed = once(clientSocket, "close");
      clientSocket.destroy();

      await clientClosed;

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(backend.activeConnections, 0);
    } finally {
      clientServer.close();
      silentBackendServer.close();
    }
  });

  it("returns 502 when no backend is available", async () => {
    const unavailableServer = net.createServer();
    const unavailablePort = await listen(unavailableServer);

    await new Promise<void>((resolve, reject) => {
      unavailableServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const unavailableBackend = createBackend(
      unavailablePort,
      "unavailable-backend",
    );

    const clientServer = net.createServer((clientSocket) => {
      proxyToBackend({
        clientSocket,
        backend: unavailableBackend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        ),
        backends: [unavailableBackend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            socket.write(
              "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            );
          },
        );

        const chunks: Buffer[] = [];

        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
        socket.on("error", reject);
      });

      assert.match(response, /^HTTP\/1\.1 502 Bad Gateway/);
      assert.match(response, /\r\n\r\nBad Gateway$/);
      assert.equal(unavailableBackend.activeConnections, 0);
    } finally {
      clientServer.close();
    }
  });

  it("returns 502 when a backend accepts the connection but never responds", async () => {
    const silentBackendServer = net.createServer(() => {
      // Accept the connection but intentionally never respond.
    });

    const backendPort = await listen(silentBackendServer);
    const silentBackend = createBackend(backendPort, "silent-backend");

    const clientServer = net.createServer((clientSocket) => {
      proxyToBackend({
        clientSocket,
        backend: silentBackend,
        data: Buffer.from(
          "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        ),
        backends: [silentBackend],
        context: createRequestContext(),
        rateLimitInfo: {
          allowed: true,
          limit: 100,
          remaining: 99,
          retryAfterSeconds: 60,
        },
      });
    });

    const proxyPort = await listen(clientServer);

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection(
          { host: "127.0.0.1", port: proxyPort },
          () => {
            socket.write(
              "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            );
          },
        );

        const chunks: Buffer[] = [];

        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () => resolve(Buffer.concat(chunks).toString()));
        socket.on("error", reject);
      });

      assert.match(response, /^HTTP\/1\.1 502 Bad Gateway/);
      assert.match(response, /\r\n\r\nBad Gateway$/);
      assert.equal(silentBackend.activeConnections, 0);
    } finally {
      clientServer.close();
      silentBackendServer.close();
    }
  });
});
