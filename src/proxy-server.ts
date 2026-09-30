import net from "node:net";

type Backend = {
  host: string;
  port: number;
  name: string;
  activeConnections: number;
  healthy: boolean;
};

type LoadBalancingStrategy = "round-robin" | "least-connections";

const PORT = 9000;

const strategy: LoadBalancingStrategy = "round-robin";

const backends: Backend[] = [
  {
    host: "localhost",
    port: 9101,
    name: "backend-1",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: "localhost",
    port: 9102,
    name: "backend-2",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: "localhost",
    port: 9103,
    name: "backend-3",
    activeConnections: 0,
    healthy: true,
  },
];

// Health Checking
function checkBackendHealth(backend: Backend): Promise<boolean> {
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

      resolve(statusLine.includes("200"));
    });

    socket.on("error", () => {
      resolve(false);
    });
  });
}

async function runHealthChecks() {
  for (const backend of backends) {
    const healthy = await checkBackendHealth(backend);

    backend.healthy = healthy;

    console.log(`${backend.name}: ${healthy ? "healthy" : "unhealthy"}`);
  }
}

runHealthChecks();

setInterval(runHealthChecks, 5000);

function getHealthyBackends() {
  return backends.filter((backend) => backend.healthy);
}

let currentIndex = 0;

function getNextBackend() {
  const healthyBackends = getHealthyBackends();

  if (healthyBackends.length === 0) {
    return undefined;
  }

  const backend = healthyBackends[currentIndex % healthyBackends.length];

  currentIndex = (currentIndex + 1) % healthyBackends.length;

  return backend;
}

function getLeastConnectionsBackend() {
  const healthyBackends = getHealthyBackends();

  if (healthyBackends.length === 0) {
    return undefined;
  }

  return healthyBackends.reduce((least, backend) => {
    if (backend.activeConnections < least.activeConnections) {
      return backend;
    }

    return least;
  });
}

function selectBackend(): Backend {
  if (strategy === "round-robin") {
    return getNextBackend();
  }

  return getLeastConnectionsBackend();
}

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

    const backend = selectBackend();

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
