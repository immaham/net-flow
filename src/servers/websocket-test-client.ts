import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:9201/ws");

ws.on("open", () => {
  console.log("Connected through net-flow proxy");

  ws.send("Message 1");
  ws.send("Message 2");
  ws.send("Message 3");
});

ws.on("message", (data) => {
  console.log("Received:", data.toString());
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error.message);
});

ws.on("close", (code, reason) => {
  console.log("Connection closed:", code, reason.toString());
});
