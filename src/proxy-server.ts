import net from "node:net";

const PORT = 9000;

const BACKEND_HOST = "localhost";
const BACKEND_PORT = 9101;

const server = net.createServer((clientSocket) => {
  console.log("Client connected to proxy");

  clientSocket.on("data", (data) => {
    console.log("Proxy received request");

    const backendSocket = net.createConnection(
      {
        host: BACKEND_HOST,
        port: BACKEND_PORT,
      },
      () => {
        console.log("Connected to backend");

        backendSocket.write(data);
      },
    );

    backendSocket.on("data", (data) => {
      clientSocket.write(data);
    });

    backendSocket.on("end", () => {
      clientSocket.end();
    });

    backendSocket.on("error", (error) => {
      console.error("Backend socket error:", error);
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
});
