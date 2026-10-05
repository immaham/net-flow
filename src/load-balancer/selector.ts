import { getLeastConnectionsBackend } from "./least-connections.js";
import { getNextBackend } from "./round-robin.js";

import type { Backend, LoadBalancingStrategy } from "./types.js";

export function getHealthyBackends(backends: Backend[]): Backend[] {
  return backends.filter((backend) => backend.healthy);
}

export function selectBackend(
  backends: Backend[],
  strategy: LoadBalancingStrategy,
  isAvailable: (backend: Backend) => boolean,
): Backend | undefined {
  const availableBackends = backends.filter(isAvailable);

  if (strategy === "round-robin") {
    return getNextBackend(availableBackends);
  }

  return getLeastConnectionsBackend(availableBackends);
}
