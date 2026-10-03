import type { Backend } from "./types.js";

export function acquireBackend(backend: Backend) {
  backend.activeConnections++;
}

export function releaseBackend(backend: Backend) {
  if (backend.activeConnections > 0) {
    backend.activeConnections--;
  }
}
