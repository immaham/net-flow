import net from "node:net";
import type { Backend } from "../load-balancer/index.js";
import { PROXY_CONFIG } from "../config/proxy.js";

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
    let settled = false;

    const complete = (healthy: boolean) => {
      if (settled) {
        return;
      }

      settled = true;

      clearTimeout(timeout);
      socket.destroy();
      resolve(healthy);
    };

    const timeout = setTimeout(() => {
      complete(false);
    }, PROXY_CONFIG.healthCheckTimeout);

    socket.on("data", (data) => {
      response += data.toString();
    });

    socket.on("end", () => {
      const statusLine = response.split("\r\n")[0];

      const healthy = /^HTTP\/1\.[01] 200(?:\s|$)/.test(statusLine ?? "");

      complete(healthy);
    });

    socket.on("error", () => {
      complete(false);
    });

    socket.on("close", () => {
      complete(false);
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

export function startHealthChecks(
  backends: Backend[],
  intervalMs: number = PROXY_CONFIG.healthCheckInterval,
) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  const run = () => {
    if (stopped) {
      return;
    }

    inFlight = runHealthChecks(backends)
      .catch((error) => {
        console.error("Health check error:", error);
      })
      .finally(() => {
        inFlight = undefined;

        if (!stopped) {
          timer = setTimeout(run, intervalMs);
        }
      });
  };

  run();

  return async function stopHealthChecks() {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    await inFlight;
  };
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
