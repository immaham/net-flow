import net from "node:net";

type Backend = {
  host: string;
  port: number;
  name: string;
  activeConnections: number;
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
  },
  {
    host: "localhost",
    port: 9102,
    name: "backend-2",
    activeConnections: 0,
  },
  {
    host: "localhost",
    port: 9103,
    name: "backend-3",
    activeConnections: 0,
  },
];

let currentIndex = 0;

function getNextBackend(): Backend {
  const backend = backends[currentIndex];

  currentIndex = (currentIndex + 1) % backends.length;

  return backend;
}

function getLeastConnectionsBackend(): Backend {
  return backends.reduce((least, backend) => {
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

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  clientSocket.on("data", (data) => {
    console.log("Proxy received request");

    const backend = selectBackend();

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
