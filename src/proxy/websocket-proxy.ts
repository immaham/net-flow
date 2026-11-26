import net from "node:net";
import type { SocketRegistry } from "../lifecycle/socket-registry.js";

export function proxyWebSocket(
  clientSocket: net.Socket,
  initialData: Buffer,
  backendSockets?: SocketRegistry,
  target: net.TcpNetConnectOpts = {
    host: "127.0.0.1",
    port: 9201,
  },
) {
  const backendSocket = net.createConnection(target);

  backendSockets?.track(backendSocket);

  let handshakeComplete = false;
  let handshakeBuffer = Buffer.alloc(0);

  backendSocket.once("connect", () => {
    backendSocket.write(initialData);
  });

  const onBackendData = (data: Buffer) => {
    handshakeBuffer = Buffer.concat([handshakeBuffer, data]);

    const headerEnd = handshakeBuffer.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
      return;
    }

    const headers = handshakeBuffer.subarray(0, headerEnd).toString();

    if (!/^HTTP\/1\.1 101\b/.test(headers)) {
      clientSocket.end(
        "HTTP/1.1 502 Bad Gateway\r\n" +
          "Connection: close\r\n" +
          "Content-Length: 0\r\n\r\n",
      );

      backendSocket.destroy();
      return;
    }

    handshakeComplete = true;

    backendSocket.off("data", onBackendData);

    clientSocket.write(handshakeBuffer);

    // Forward all subsequent bytes in both directions.
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);
  };

  backendSocket.on("data", onBackendData);

  backendSocket.on("error", (error) => {
    console.error("WebSocket backend error:", error.message);

    if (!clientSocket.destroyed) {
      if (!handshakeComplete) {
        clientSocket.end(
          "HTTP/1.1 502 Bad Gateway\r\n" +
            "Connection: close\r\n" +
            "Content-Length: 0\r\n\r\n",
        );
      } else {
        clientSocket.destroy();
      }
    }
  });

  clientSocket.on("error", () => {
    backendSocket.destroy();
  });

  clientSocket.on("close", () => {
    backendSocket.destroy();
  });
}
