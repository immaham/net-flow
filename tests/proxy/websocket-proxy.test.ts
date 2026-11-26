import net from "node:net";
import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SocketRegistry } from "../../src/lifecycle/socket-registry.js";
import { proxyWebSocket } from "../../src/proxy/websocket-proxy.js";

async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");

  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  return address.port;
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Condition was not met before timeout");
    }

    await delay(5);
  }
}

describe("WebSocket proxy integration", () => {
  it("tracks WebSocket connections until the client disconnects", async () => {
    const clientSockets = new SocketRegistry();
    const backendSockets = new SocketRegistry();

    const backendPeerSockets = new SocketRegistry();

    const upgradeRequest =
      "GET / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n\r\n";

    const upgradeResponse =
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n\r\n";

    const backendServer = net.createServer((socket) => {
      backendPeerSockets.track(socket);

      socket.on("error", () => {});

      let request = "";

      socket.on("data", (chunk) => {
        request += chunk.toString();

        if (request.includes("\r\n\r\n")) {
          socket.write(upgradeResponse);
        }
      });
    });

    const backendPort = await listen(backendServer);

    const proxyServer = net.createServer((clientSocket) => {
      clientSockets.track(clientSocket);

      clientSocket.once("data", (requestData) => {
        proxyWebSocket(clientSocket, requestData, backendSockets, {
          host: "127.0.0.1",
          port: backendPort,
        });
      });
    });

    const proxyPort = await listen(proxyServer);

    let testSocket: net.Socket | undefined;

    try {
      testSocket = net.createConnection({
        host: "127.0.0.1",
        port: proxyPort,
      });

      let response = "";
      let socketError: Error | undefined;

      testSocket.on("error", (error) => {
        socketError = error;
      });

      testSocket.on("data", (chunk) => {
        response += chunk.toString();
      });

      await once(testSocket, "connect");

      testSocket.write(upgradeRequest);

      await waitFor(
        () => response.includes("\r\n\r\n") || socketError !== undefined,
      );

      assert.ifError(socketError);

      assert.equal(response, upgradeResponse);

      assert.equal(clientSockets.size, 1);
      assert.equal(backendSockets.size, 1);
      assert.equal(backendPeerSockets.size, 1);

      assert.equal(testSocket.destroyed, false);

      testSocket.destroy();

      await waitFor(
        () =>
          clientSockets.size === 0 &&
          backendSockets.size === 0 &&
          backendPeerSockets.size === 0,
      );

      assert.equal(clientSockets.size, 0);
      assert.equal(backendSockets.size, 0);
      assert.equal(backendPeerSockets.size, 0);
    } finally {
      testSocket?.destroy();

      clientSockets.destroyAll();
      backendSockets.destroyAll();
      backendPeerSockets.destroyAll();

      await Promise.all([
        new Promise<void>((resolve) => {
          proxyServer.close(() => resolve());
        }),
        new Promise<void>((resolve) => {
          backendServer.close(() => resolve());
        }),
      ]);
    }
  });
});
