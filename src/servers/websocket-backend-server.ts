import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT) || 9201;

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("WebSocket backend: client connected");

  ws.on("message", (data, isBinary) => {
    console.log("WebSocket backend received:", data.toString());

    ws.send(data, { binary: isBinary });
  });

  ws.on("close", () => {
    console.log("WebSocket backend: client disconnected");
  });

  ws.on("error", (error) => {
    console.error("WebSocket backend error:", error);
  });
});

wss.on("listening", () => {
  console.log(`WebSocket backend listening on port ${PORT}`);
});

wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});
