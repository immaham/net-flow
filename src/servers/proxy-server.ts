import net from "node:net";
import { selectBackend } from "../load-balancer/index.js";
import type { LoadBalancingStrategy } from "../load-balancer/index.js";
import { backends } from "../config/backends.js";
import { runHealthChecks } from "../health/health-checker.js";

const PORT = 9000;
const strategy: LoadBalancingStrategy = "round-robin";

runHealthChecks(backends);
setInterval(() => {
  runHealthChecks(backends);
}, 5000);

function sendServiceUnavailable(socket: net.Socket) {
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

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  clientSocket.on("data", (data) => {
    console.log("Proxy received request");

    const backend = selectBackend(backends, strategy);

    if (!backend) {
      sendServiceUnavailable(clientSocket);
      return;
    }

    console.log(`Selected ${backend.name} (${backend.host}:${backend.port})`);

    backend.activeConnections++;

    console.log(
      `${backend.name} active connections: ${backend.activeConnections}`,
    );

    let connectionReleased = false;

    const releaseConnection = () => {
      if (connectionReleased) {
        return;
      }

      connectionReleased = true;
      backend.activeConnections--;

      console.log(
        `${backend.name} active connections: ${backend.activeConnections}`,
      );
    };

    const backendSocket = net.createConnection(
      {
        host: backend.host,
        port: backend.port,
      },
      () => {
        console.log(`Connected to ${backend.name}`);

        backendSocket.write(data);
      },
    );

    backendSocket.on("data", (data) => {
      clientSocket.write(data);
    });

    backendSocket.on("end", () => {
      releaseConnection();
      clientSocket.end();
    });

    backendSocket.on("error", (error) => {
      releaseConnection();

      console.error(`${backend.name} socket error:`, error);

      clientSocket.end();
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
