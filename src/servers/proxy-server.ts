import net from "node:net";

import { selectBackend } from "../load-balancer/index.js";
import { backends, PORT, strategy } from "../config/backends.js";
import {
  runHealthChecks,
  sendServiceUnavailable,
} from "../health/health-checker.js";
import { proxyToBackend } from "../proxy/proxy.js";
import { isBackendAvailable } from "../circuit-breaker/registry.js";

runHealthChecks(backends);

setInterval(() => {
  runHealthChecks(backends);
}, 5000);

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  clientSocket.on("data", (data) => {
    console.log("Proxy received request");

    const requestData = Buffer.isBuffer(data) ? data : Buffer.from(data);

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
