import net from "node:net";

const PORT = Number(process.env.PORT) || 9000;

const server = net.createServer((socket) => {
  console.log(
    ` ${socket.remoteAddress} on port ${socket.remotePort} connected on family ${socket.remoteFamily} to ${socket.localAddress} on port ${socket.localPort}`,
  );
  socket.on("data", (data) => {
    console.log(`Received data: ${data}`);
    socket.write(`Echo: ${data}`);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  socket.on("end", () => {
    console.log("Client disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
