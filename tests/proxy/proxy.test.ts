import net from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { proxyToBackend } from "../../src/proxy/proxy.js";
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
    assert.equal(unavailableBackend.activeConnections, 0);
    assert.equal(healthyBackend.activeConnections, 0);
  } finally {
    clientServer.close();
    backendServer.close();
  }
});

describe("Proxy integration", () => {
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
