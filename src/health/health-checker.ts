import net from "node:net";
import type { Backend } from "../load-balancer/index.js";

export function checkBackendHealth(backend: Backend): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      {
        host: backend.host,
        port: backend.port,
      },
      () => {
        const request =
          `GET /health HTTP/1.1\r\n` +
          `Host: ${backend.host}:${backend.port}\r\n` +
          `Connection: close\r\n` +
          `\r\n`;

        socket.write(request);
      },
    );

    let response = "";

    socket.on("data", (data) => {
      response += data.toString();
    });

    socket.on("end", () => {
      const statusLine = response.split("\r\n")[0];

      if (!statusLine) {
        resolve(false);
        return;
      }

      resolve(statusLine.includes("200"));
    });

    socket.on("error", () => {
      resolve(false);
    });
  });
}

export async function runHealthChecks(backends: Backend[]) {
  for (const backend of backends) {
    const healthy = await checkBackendHealth(backend);

    backend.healthy = healthy;

    console.log(`${backend.name}: ${healthy ? "healthy" : "unhealthy"}`);
  }
}

export function sendServiceUnavailable(socket: net.Socket) {
  const body = "No healthy backends available";

  const response =
    `HTTP/1.1 503 Service Unavailable\r\n` +
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body;

  socket.write(response);
  socket.end();
}
