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
};

export function proxyToBackend({
  clientSocket,
  backend,
  data,
  backends,
  context,
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

  const recordFailure = () => {
    if (failureRecorded) {
      return;
    }

    failureRecorded = true;

    recordBackendFailure(backend.name);
    circuit.recordFailure();
  };

  const completeRequest = (success: boolean) => {
    if (requestCompleted) {
      return;
    }

    requestCompleted = true;

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
    );
  };

  const backendSocket = net.createConnection(
    {
      host: backend.host,
      port: backend.port,
    },
    () => {
      log("INFO", "Connected to backend", {
        requestId: context.id,
        backend: backend.name,
      });

      backendSocket.write(data);
    },
  );

  backendSocket.setTimeout(PROXY_CONFIG.backendSocketTimeout);

  backendSocket.on("data", (data) => {
    responseStarted = true;

    circuit.recordSuccess();

    clientSocket.write(data);
  });

  backendSocket.on("end", () => {
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
    log("ERROR", "Backend socket timeout", {
      requestId: context.id,
      backend: backend.name,
    });

    recordFailure();

    backendSocket.destroy();
    retry();
  });

  backendSocket.on("error", (error) => {
    log("ERROR", "Backend socket error", {
      requestId: context.id,
      backend: backend.name,
      error: error.message,
    });

    recordFailure();
    retry();
  });
}
