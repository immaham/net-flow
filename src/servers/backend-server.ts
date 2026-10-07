import net from "node:net";

const PORT = Number(process.env.PORT) || 9101;
const INSTANCE_NAME = process.env.INSTANCE_NAME || "backend-1";

const server = net.createServer((socket) => {
  console.log(`${INSTANCE_NAME}: client connected`);

  socket.on("data", (data) => {
    const request = data.toString();

    const requestLine = request.split("\r\n")[0];
    if (!requestLine) {
      return;
    }
    const [method, path] = requestLine.split(" ");

    console.log(`${INSTANCE_NAME} received:`);
    console.log(request);

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
