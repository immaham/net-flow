import net from "node:net";

const PORT = 9101;

const server = net.createServer((socket) => {
  socket.on("data", (data) => {
    const request = data.toString();

    console.log("Backend received:");
    console.log(request);

    const body = "Hello from backend-1";

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
    console.error("Backend socket error:", error);
  });
});

server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
