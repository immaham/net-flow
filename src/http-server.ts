import net from "node:net";

const PORT = Number(process.env.PORT) || 9000;

const server = net.createServer((socket) => {
  console.log("Client connected");

  socket.on("data", (data) => {
    const request = data.toString();

    console.log(request);

    const lines = request.split("\r\n");

    const requestLine = lines[0];

    const [method, path, version] = requestLine.split(" ");

    const headers: Record<string, string> = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (!line) break;

      const [key, ...valueParts] = line.split(":");

      const value = valueParts.join(":").trim();

      headers[key.toLowerCase()] = value;
    }

    console.log({
      method,
      path,
      version,
      headers,
    });

    const body = "Hello from net-flow";

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
    console.error("Socket error:", error);
  });
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});
