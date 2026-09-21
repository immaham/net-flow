import net from "node:net";

const PORT = Number(process.env.PORT) || 9000;

const server = net.createServer((socket) => {
  console.log("Client connected");
  socket.on("data", (data) => {
    console.log(`Received data: ${data}`);
    socket.write(`Echo: ${data}`);
  });

  socket.on("end", () => {
    console.log("Client disconnected");
  });
});

server.on("connection", (socket) => {
  console.log(
    ` ${socket.remoteAddress} on port ${socket.remotePort} connected on family ${socket.remoteFamily} to ${socket.localAddress} on port ${socket.localPort}`,
  );
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} `);
});
