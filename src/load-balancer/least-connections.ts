import type { Backend } from "./types.js";

export function getLeastConnectionsBackend(
  backends: Backend[],
): Backend | undefined {
  if (backends.length === 0) {
    return undefined;
  }

  return backends.reduce((least, backend) => {
    if (backend.activeConnections < least.activeConnections) {
      return backend;
    }

    return least;
  });
}
