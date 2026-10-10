import net from "node:net";

import { selectBackend } from "../load-balancer/index.js";
import { backends, PORT, strategy } from "../config/backends.js";
import {
  runHealthChecks,
  sendServiceUnavailable,
} from "../health/health-checker.js";
import { proxyToBackend } from "../proxy/proxy.js";
import {
  isBackendAvailable,
  getCircuitState,
} from "../circuit-breaker/registry.js";
import { createRequestContext } from "../observability/request-context.js";
import { log } from "../observability/logger.js";
import { getMetrics, recordRequestStart } from "../observability/metrics.js";
import { proxyWebSocket } from "../proxy/websocket-proxy.js";
import { connectRedis } from "../redis/redis-client.js";
import { applyRateLimit } from "../middleware/rate-limit-middleware.js";

runHealthChecks(backends);

setInterval(() => {
  runHealthChecks(backends);
}, 10000);

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  const handleClientData = async (data: Buffer) => {
    const context = createRequestContext();
    const requestData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const requestText = requestData.toString();

    // Handle WebSocket upgrade before normal HTTP processing.
    if (
      /^GET\s+/i.test(requestText) &&
      /\bupgrade:\s*websocket\b/i.test(requestText) &&
      /\bconnection:[^\r\n]*\bupgrade\b/i.test(requestText)
    ) {
      clientSocket.off("data", handleClientData);
      proxyWebSocket(clientSocket, requestData);
      return;
    }

    // Handle metrics before rate limiting.
    if (requestText.startsWith("GET /metrics")) {
      const metrics = getMetrics();
      const body = JSON.stringify(metrics);

      const response =
        `HTTP/1.1 200 OK\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body;

      clientSocket.end(response);
      return;
    }

    // Apply rate limiting to regular HTTP requests.
    try {
      const allowed = await applyRateLimit(clientSocket);

      if (!allowed) {
        return;
      }
    } catch (error) {
      console.error("Rate limiter error:", error);

      if (!clientSocket.destroyed) {
        const body = JSON.stringify({
          error: "Service Unavailable",
          message: "Rate limiting service is unavailable",
        });

        clientSocket.end(
          `HTTP/1.1 503 Service Unavailable\r\n` +
            `Content-Type: application/json\r\n` +
            `Content-Length: ${Buffer.byteLength(body)}\r\n` +
            `Connection: close\r\n` +
            `\r\n` +
            body,
        );
      }

      return;
    }

    recordRequestStart();

    log("INFO", "Proxy received request", {
      requestId: context.id,
    });

    const backend = selectBackend(
      backends,
      strategy,
      isBackendAvailable,
      getCircuitState,
    );

    if (!backend) {
      console.error("No healthy backends available");
      sendServiceUnavailable(clientSocket);
      return;
    }

    console.log(`Selected ${backend.name} (${backend.host}:${backend.port})`);

    proxyToBackend({
      clientSocket,
      backend,
      data: requestData,
      backends,
      context,
    });
  };

  clientSocket.on("data", handleClientData);

  clientSocket.on("end", () => {
    console.log("Client disconnected");
  });

  clientSocket.on("error", (error) => {
    console.error("Client socket error:", error);
  });
});

async function startProxy() {
  await connectRedis();

  server.listen(PORT, () => {
    console.log(`Proxy listening on port ${PORT}`);
    console.log(`Load balancing strategy: ${strategy}`);
  });
}

startProxy().catch((error) => {
  console.error("Failed to start proxy:", error);
  process.exitCode = 1;
});
