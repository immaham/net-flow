import net from "node:net";

import type { Backend } from "../load-balancer/index.js";
import {
  acquireBackend,
  releaseBackend,
} from "../load-balancer/connection-tracker.js";
import { PROXY_CONFIG } from "../config/proxy.js";
import { sendBadGateway } from "./proxy-errors.js";
import { getCircuitBreaker } from "../circuit-breaker/registry.js";

export type ProxyRequestOptions = {
  clientSocket: net.Socket;
  backend: Backend;
  data: Buffer;
  backends: Backend[];
};

export function proxyToBackend({
  clientSocket,
  backend,
  data,
  backends,
}: ProxyRequestOptions) {
  const attemptedBackends = new Set<string>();

  attemptBackend(clientSocket, backend, data, backends, attemptedBackends, 0);
}

function attemptBackend(
  clientSocket: net.Socket,
  backend: Backend,
  data: Buffer,
  backends: Backend[],
  attemptedBackends: Set<string>,
  retryCount: number,
) {
  attemptedBackends.add(backend.name);
  const circuit = getCircuitBreaker(backend);

  acquireBackend(backend);

  console.log(
    `${backend.name} active connections: ${backend.activeConnections}`,
  );

  let released = false;
  let responseStarted = false;
  let failureRecorded = false;

  const recordFailure = () => {
    if (failureRecorded) {
      return;
    }

    failureRecorded = true;
    circuit.recordFailure();
  };

  const releaseConnection = () => {
    if (released) {
      return;
    }

    released = true;
    releaseBackend(backend);

    console.log(
      `${backend.name} active connections: ${backend.activeConnections}`,
    );
  };

  const retry = () => {
    releaseConnection();

    if (retryCount >= PROXY_CONFIG.maxRetries) {
      sendBadGateway(clientSocket);
      return;
    }

    const retryBackend = backends.find(
      (candidate) =>
        candidate.healthy && !attemptedBackends.has(candidate.name),
    );

    if (!retryBackend) {
      sendBadGateway(clientSocket);
      return;
    }

    console.log(`Retrying request with ${retryBackend.name}`);

    attemptBackend(
      clientSocket,
      retryBackend,
      data,
      backends,
      attemptedBackends,
      retryCount + 1,
    );
  };

  const backendSocket = net.createConnection(
    {
      host: backend.host,
      port: backend.port,
    },
    () => {
      console.log(`Connected to ${backend.name}`);

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
      retry();
      return;
    }

    releaseConnection();
    clientSocket.end();
  });

  backendSocket.on("timeout", () => {
    console.error(`${backend.name} connection timeout`);

    recordFailure();
    backendSocket.destroy();

    retry();
  });

  backendSocket.on("error", (error) => {
    console.error(`${backend.name} socket error:`, error);

    recordFailure();
    retry();
  });
}
