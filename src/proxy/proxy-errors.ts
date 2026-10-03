import net from "node:net";

export function sendBadGateway(socket: net.Socket) {
  const body = "Bad Gateway";

  const response =
    `HTTP/1.1 502 Bad Gateway\r\n` +
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body;

  socket.write(response);
  socket.end();
}
