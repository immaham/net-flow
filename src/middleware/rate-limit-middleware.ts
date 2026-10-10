import type net from "node:net";
import { checkRateLimit } from "../redis/rate-limiter.js";

const RATE_LIMIT = 5;
const WINDOW_SECONDS = 60;

export async function applyRateLimit(
  clientSocket: net.Socket,
): Promise<boolean> {
  const clientIp = clientSocket.remoteAddress ?? "unknown";
  const key = `rate-limit:${clientIp}`;

  const result = await checkRateLimit(key, {
    limit: RATE_LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });

  if (result.allowed) {
    return true;
  }

  const body = JSON.stringify({
    error: "Too Many Requests",
    retryAfterSeconds: result.retryAfterSeconds,
  });

  clientSocket.end(
    `HTTP/1.1 429 Too Many Requests\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Retry-After: ${result.retryAfterSeconds}\r\n` +
      `Connection: close\r\n` +
      `\r\n` +
      body,
  );

  return false;
}
