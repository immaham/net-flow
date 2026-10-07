import net from "node:net";

import { selectBackend } from "../load-balancer/index.js";
import { backends, PORT, strategy } from "../config/backends.js";
import {
  runHealthChecks,
  sendServiceUnavailable,
} from "../health/health-checker.js";
import { proxyToBackend } from "../proxy/proxy.js";
import { isBackendAvailable } from "../circuit-breaker/registry.js";
import { createRequestContext } from "../observability/request-context.js";
import { log } from "../observability/logger.js";
import { getMetrics, recordRequestStart } from "../observability/metrics.js";

runHealthChecks(backends);

setInterval(() => {
  runHealthChecks(backends);
}, 10000);

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  clientSocket.on("data", (data) => {
    const context = createRequestContext();

    const requestData = Buffer.isBuffer(data) ? data : Buffer.from(data);

    const requestText = requestData.toString();

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

    recordRequestStart();

    log("INFO", "Proxy received request", {
      requestId: context.id,
    });

    const backend = selectBackend(backends, strategy, isBackendAvailable);

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
  });

  clientSocket.on("end", () => {
    console.log("Client disconnected");
  });

  clientSocket.on("error", (error) => {
    console.error("Client socket error:", error);
  });
});

server.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
  console.log(`Load balancing strategy: ${strategy}`);
});
