import net from "node:net";
import { selectBackend } from "../load-balancer/index.js";
import { backends, PORT, strategy } from "../config/backends.js";
import {
  runHealthChecks,
  sendServiceUnavailable,
} from "../health/health-checker.js";

runHealthChecks(backends);
setInterval(() => {
  runHealthChecks(backends);
}, 5000);

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
