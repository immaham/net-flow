import type { Backend } from "../load-balancer/types.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { recordCircuitState } from "../observability/metrics.js";

const circuits = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(backend: Backend): CircuitBreaker {
  let circuit = circuits.get(backend.name);

  if (!circuit) {
    circuit = new CircuitBreaker();
    circuits.set(backend.name, circuit);
  }

  return circuit;
}

export function isBackendAvailable(backend: Backend): boolean {
  if (!backend.healthy) {
    return false;
  }

  const circuit = getCircuitBreaker(backend);

  const available = circuit.canRequest();
  recordCircuitState(backend.name, circuit.getState());
  console.log(
    `${backend.name} circuit: ${circuit.getState()} available: ${available}`,
  );

  return available;
}
