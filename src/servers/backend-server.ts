import net from "node:net";
import {
  faultConfig,
  updateFaultConfig,
} from "../fault-injection/fault-config.js";

const PORT = Number(process.env.PORT) || 9101;
const INSTANCE_NAME = process.env.INSTANCE_NAME || "backend-1";

const server = net.createServer((socket) => {
  console.log(`${INSTANCE_NAME}: client connected`);

  socket.on("data", async (data) => {
    const request = data.toString();
    const requestLine = request.split("\r\n")[0];

    if (!requestLine) {
      return;
    }

    const [method, path] = requestLine.split(" ");

    const url = new URL(path, `http://${INSTANCE_NAME}`);

    if (method === "GET" && url.pathname === "/faults") {
      const enabled = url.searchParams.get("enabled");
      const latency = url.searchParams.get("latency");
      const failureRate = url.searchParams.get("failureRate");

      updateFaultConfig({
        ...(enabled !== null && {
          enabled: enabled === "true",
        }),
        ...(latency !== null && {
          latencyMs: Number(latency),
        }),
        ...(failureRate !== null && {
          failureRate: Number(failureRate),
        }),
      });

      const body = JSON.stringify(faultConfig);

      const response =
        `HTTP/1.1 200 OK\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body;

      socket.end(response);
      return;
    }

    console.log(`${INSTANCE_NAME} received:`);
    console.log(request);

    const isHealthCheck = path === "/health";

    if (!isHealthCheck && faultConfig.enabled && faultConfig.latencyMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, faultConfig.latencyMs);
      });
    }

    if (
      !isHealthCheck &&
      faultConfig.enabled &&
      faultConfig.failureRate > 0 &&
      Math.random() < faultConfig.failureRate
    ) {
      console.log("Fault injection: simulated failure");

      socket.destroy();

      return;
    }

    let body: string;

    if (path === "/health") {
      body = "OK";
    } else {
      body = `Hello from ${INSTANCE_NAME}`;
    }

    const response =
      `HTTP/1.1 200 OK\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n` +
      `\r\n` +
      body;

    socket.write(response);
    socket.end();
  });

  socket.on("error", (error) => {
    console.error(`${INSTANCE_NAME} socket error:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`${INSTANCE_NAME} listening on port ${PORT}`);
});
