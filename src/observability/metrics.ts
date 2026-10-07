export type BackendMetrics = {
  requests: number;
  failures: number;
};
export type CircuitMetrics = {
  state: string;
};
export type Metrics = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  backends: Record<string, BackendMetrics>;
  circuits: Record<string, CircuitMetrics>;
};

const metrics: Metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalDurationMs: 0,
  backends: {},
  circuits: {},
};

export function recordCircuitState(backendName: string, state: string) {
  metrics.circuits[backendName] = {
    state,
  };
}

export function recordRequestStart() {
  metrics.totalRequests++;
}

export function recordBackendRequest(backendName: string) {
  if (!metrics.backends[backendName]) {
    metrics.backends[backendName] = {
      requests: 0,
      failures: 0,
    };
  }

  metrics.backends[backendName].requests++;
}

export function recordBackendFailure(backendName: string) {
  if (!metrics.backends[backendName]) {
    metrics.backends[backendName] = {
      requests: 0,
      failures: 0,
    };
  }

  metrics.backends[backendName].failures++;
}

export function recordRequestSuccess(durationMs: number) {
  metrics.successfulRequests++;
  metrics.totalDurationMs += durationMs;
}

export function recordRequestFailure(durationMs: number) {
  metrics.failedRequests++;
  metrics.totalDurationMs += durationMs;
}

export function getMetrics(): Metrics {
  return {
    ...metrics,
    backends: Object.fromEntries(
      Object.entries(metrics.backends).map(([name, value]) => [
        name,
        { ...value },
      ]),
    ),
    circuits: Object.fromEntries(
      Object.entries(metrics.circuits).map(([name, value]) => [
        name,
        { ...value },
      ]),
    ),
  };
}
