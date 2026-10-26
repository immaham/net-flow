import net from "node:net";
import type { Backend } from "../load-balancer/index.js";
import {
  acquireBackend,
  releaseBackend,
} from "../load-balancer/connection-tracker.js";
import { PROXY_CONFIG } from "../config/proxy.js";
import { sendBadGateway } from "./proxy-errors.js";
import { getCircuitBreaker } from "../circuit-breaker/registry.js";
import type { RequestContext } from "../observability/request-context.js";
import { log } from "../observability/logger.js";
import type { RateLimitInfo } from "../middleware/rate-limit-middleware.js";
import {
  recordBackendRequest,
  recordBackendFailure,
  recordRequestSuccess,
  recordRequestFailure,
} from "../observability/metrics.js";

export type ProxyRequestOptions = {
  clientSocket: net.Socket;
  backend: Backend;
  data: Buffer;
  backends: Backend[];
  context: RequestContext;
  rateLimitInfo: RateLimitInfo;
};

export function writeWithBackpressure(
  source: net.Socket,
  destination: net.Socket,
  chunk: Buffer,
): boolean {
  const canContinue = destination.write(chunk);

  if (!canContinue) {
    source.pause();
  }

  return canContinue;
}

export function proxyToBackend({
  clientSocket,
  backend,
  data,
  backends,
  context,
  rateLimitInfo,
}: ProxyRequestOptions) {
  const attemptedBackends = new Set<string>();

  attemptBackend(
    clientSocket,
    backend,
    data,
    backends,
    attemptedBackends,
    0,
    context,
    rateLimitInfo,
  );
}

function attemptBackend(
  clientSocket: net.Socket,
  backend: Backend,
  data: Buffer,
  backends: Backend[],
  attemptedBackends: Set<string>,
  retryCount: number,
  context: RequestContext,
  rateLimitInfo: RateLimitInfo,
) {
  attemptedBackends.add(backend.name);

  const circuit = getCircuitBreaker(backend);

  acquireBackend(backend);
  recordBackendRequest(backend.name);

  log("INFO", "Backend connection acquired", {
    requestId: context.id,
    backend: backend.name,
    activeConnections: backend.activeConnections,
  });

  let released = false;
  let responseStarted = false;
  let failureRecorded = false;
  let requestCompleted = false;
  let responseHeadersProcessed = false;
  let protocolUpgraded = false;
  let pendingResponse = Buffer.alloc(0);

  const releaseConnection = () => {
    if (released) {
      return;
    }

    released = true;

    releaseBackend(backend);

    log("INFO", "Backend connection released", {
      requestId: context.id,
      backend: backend.name,
      activeConnections: backend.activeConnections,
    });
  };

  const handleClientClose = () => {
    if (requestCompleted) {
      return;
    }

    if (protocolUpgraded) {
      backendSocket.destroy();
      releaseConnection();
      completeRequest(true);
      return;
    }

    log("WARN", "Client disconnected before request completed", {
      requestId: context.id,
      backend: backend.name,
    });

    backendSocket.destroy();
    releaseConnection();
    completeRequest(false);
  };

  const recordFailure = () => {
    if (failureRecorded) {
      return;
    }

    failureRecorded = true;

    recordBackendFailure(backend.name);
    circuit.recordFailure();
  };

  const cleanupBackpressureListeners = () => {
    backendSocket.off("drain", handleBackendDrain);
    clientSocket.off("drain", handleClientDrain);
  };

  const completeRequest = (success: boolean) => {
    if (requestCompleted) {
      return;
    }

    requestCompleted = true;

    clientSocket.off("close", handleClientClose);
    cleanupBackpressureListeners();

    log("INFO", "Completing request", {
      requestId: context.id,
      success,
      responseStarted,
      clientDestroyed: clientSocket.destroyed,
      clientWritableEnded: clientSocket.writableEnded,
      backend: backend.name,
      retryCount,
    });

    const durationMs = Date.now() - context.startedAt;

    if (success) {
      recordRequestSuccess(durationMs);
    } else {
      recordRequestFailure(durationMs);
    }

    log(success ? "INFO" : "ERROR", "Request completed", {
      requestId: context.id,
      durationMs,
      success,
    });
  };

  const failRequest = () => {
    releaseConnection();
    completeRequest(false);
    sendBadGateway(clientSocket);
  };

  const retry = () => {
    cleanupBackpressureListeners();
    clientSocket.off("close", handleClientClose);
    releaseConnection();
    /*
     * Once response data has been sent to the client,
     * retrying the request could corrupt the response.
     */
    if (responseStarted) {
      completeRequest(false);
      clientSocket.destroy();
      return;
    }

    if (retryCount >= PROXY_CONFIG.maxRetries) {
      failRequest();
      return;
    }

    const retryBackend = backends.find(
      (candidate) =>
        candidate.healthy && !attemptedBackends.has(candidate.name),
    );

    if (!retryBackend) {
      failRequest();
      return;
    }

    log("WARN", "Retrying request", {
      requestId: context.id,
      backend: retryBackend.name,
      retryCount: retryCount + 1,
    });

    attemptBackend(
      clientSocket,
      retryBackend,
      data,
      backends,
      attemptedBackends,
      retryCount + 1,
      context,
      rateLimitInfo,
    );
  };

  const backendSocket = net.createConnection({
    host: backend.host,
    port: backend.port,
  });

  const handleBackendDrain = () => {
    if (!clientSocket.destroyed) {
      clientSocket.resume();
    }
  };

  const handleClientDrain = () => {
    if (!backendSocket.destroyed) {
      backendSocket.resume();
    }
  };

  backendSocket.on("drain", handleBackendDrain);
  clientSocket.on("drain", handleClientDrain);

  backendSocket.on("connect", () => {
    log("INFO", "Connected to backend", {
      requestId: context.id,
      backend: backend.name,
    });

    writeWithBackpressure(clientSocket, backendSocket, data);
  });

  backendSocket.setTimeout(PROXY_CONFIG.backendSocketTimeout);
  clientSocket.once("close", handleClientClose);
  backendSocket.on("data", (data) => {
    responseStarted = true;

    circuit.recordSuccess();

    if (clientSocket.destroyed || clientSocket.writableEnded) {
      backendSocket.destroy();
      releaseConnection();
      completeRequest(false);
      return;
    }

    if (responseHeadersProcessed) {
      writeWithBackpressure(
        backendSocket,
        clientSocket,
        Buffer.isBuffer(data) ? data : Buffer.from(data),
      );
      return;
    }

    const responseChunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

    pendingResponse = Buffer.concat([pendingResponse, responseChunk]);
    const headerEnd = pendingResponse.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
      return;
    }

    const headers = pendingResponse.subarray(0, headerEnd).toString("latin1");
    const body = pendingResponse.subarray(headerEnd + 4);

    const statusLine = headers.split("\r\n", 1)[0] ?? "";
    const isProtocolUpgrade = /^HTTP\/\d(?:\.\d)?\s+101(?:\s|$)/i.test(
      statusLine,
    );

    if (isProtocolUpgrade) {
      // Switch from HTTP proxying to a bidirectional tunnel.
      protocolUpgraded = true;

      // Disable the regular backend response timeout for the tunnel.
      backendSocket.setTimeout(0);

      // Forward client data (e.g. WebSocket frames) to the backend.
      clientSocket.on("data", (chunk) => {
        if (!backendSocket.destroyed && backendSocket.writable) {
          writeWithBackpressure(
            clientSocket,
            backendSocket,
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          );
        }
      });

      writeWithBackpressure(backendSocket, clientSocket, pendingResponse);
    } else {
      const updatedHeaders =
        `${headers}\r\n` +
        `X-RateLimit-Limit: ${rateLimitInfo.limit}\r\n` +
        `X-RateLimit-Remaining: ${rateLimitInfo.remaining}`;

      writeWithBackpressure(
        backendSocket,
        clientSocket,
        Buffer.concat([
          Buffer.from(`${updatedHeaders}\r\n\r\n`, "latin1"),
          body,
        ]),
      );
    }

    responseHeadersProcessed = true;
    pendingResponse = Buffer.alloc(0);
  });

  backendSocket.on("end", () => {
    if (protocolUpgraded) {
      releaseConnection();
      completeRequest(true);
      clientSocket.end();
      return;
    }

    if (!responseStarted) {
      recordFailure();
      retry();
      return;
    }

    releaseConnection();
    completeRequest(true);

    clientSocket.end();
  });

  backendSocket.on("timeout", () => {
    if (protocolUpgraded) {
      backendSocket.destroy();
      releaseConnection();
      completeRequest(false);
      clientSocket.destroy();
      return;
    }
    log("ERROR", "Backend socket timeout", {
      requestId: context.id,
      backend: backend.name,
    });

    recordFailure();

    backendSocket.destroy();
    retry();
  });

  backendSocket.on("error", (error) => {
    if (protocolUpgraded) {
      backendSocket.destroy();
      releaseConnection();
      completeRequest(false);
      clientSocket.destroy();
      return;
    }
    log("ERROR", "Backend socket error", {
      requestId: context.id,
      backend: backend.name,
      error: error.message,
    });

    recordFailure();
    retry();
  });
}
