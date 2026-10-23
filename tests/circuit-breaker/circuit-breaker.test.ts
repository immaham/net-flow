import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CircuitBreaker } from "../../src/circuit-breaker/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts in CLOSED state and allows requests", () => {
    const circuit = new CircuitBreaker();

    assert.equal(circuit.getState(), "CLOSED");
    assert.equal(circuit.canRequest(), true);
  });

  it("opens after reaching the failure threshold", () => {
    const circuit = new CircuitBreaker(3, 10_000);

    circuit.recordFailure();
    circuit.recordFailure();

    assert.equal(circuit.getState(), "CLOSED");

    circuit.recordFailure();

    assert.equal(circuit.getState(), "OPEN");
    assert.equal(circuit.canRequest(), false);
  });

  it("moves to HALF_OPEN after the reset timeout", () => {
    const circuit = new CircuitBreaker(1, 20);

    circuit.recordFailure();

    assert.equal(circuit.getState(), "OPEN");

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(circuit.canRequest(), true);
        assert.equal(circuit.getState(), "HALF_OPEN");

        resolve();
      }, 30);
    });
  });

  it("allows only one request in HALF_OPEN", () => {
    const circuit = new CircuitBreaker(1, 0);

    circuit.recordFailure();

    assert.equal(circuit.canRequest(), true);
    assert.equal(circuit.getState(), "HALF_OPEN");

    assert.equal(circuit.canRequest(), false);
  });

  it("closes after a successful HALF_OPEN request", () => {
    const circuit = new CircuitBreaker(1, 0);

    circuit.recordFailure();
    circuit.canRequest();

    circuit.recordSuccess();

    assert.equal(circuit.getState(), "CLOSED");
    assert.equal(circuit.canRequest(), true);
  });

  it("reopens after a failed HALF_OPEN request", () => {
    const circuit = new CircuitBreaker(1, 0);

    circuit.recordFailure();

    assert.equal(circuit.canRequest(), true);
    assert.equal(circuit.getState(), "HALF_OPEN");

    circuit.recordFailure();

    assert.equal(circuit.getState(), "OPEN");
  });
});
