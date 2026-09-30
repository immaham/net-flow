import { getLeastConnectionsBackend, getNextBackend } from "./index.js";

import type { Backend, LoadBalancingStrategy } from "./types.js";

export function getHealthyBackends(backends: Backend[]): Backend[] {
  return backends.filter((backend) => backend.healthy);
}

export function selectBackend(
  backends: Backend[],
  strategy: LoadBalancingStrategy,
): Backend | undefined {
  const healthyBackends = getHealthyBackends(backends);

  if (strategy === "round-robin") {
    return getNextBackend(healthyBackends);
  }

  return getLeastConnectionsBackend(healthyBackends);
}
