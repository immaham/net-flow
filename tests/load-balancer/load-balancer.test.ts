import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getNextBackend,
  getLeastConnectionsBackend,
  getHealthyBackends,
  selectBackend,
} from "../../src/load-balancer/index.js";

import type { Backend } from "../../src/load-balancer/index.js";

function createBackend(
  name: string,
  activeConnections = 0,
  healthy = true,
): Backend {
  return {
    host: "127.0.0.1",
    port: 9101,
    name,
    activeConnections,
    healthy,
  };
}

describe("Load Balancer", () => {
  it("returns undefined when there are no backends", () => {
    assert.equal(getNextBackend([]), undefined);
    assert.equal(getLeastConnectionsBackend([]), undefined);
  });

  it("selects backends using round-robin", () => {
    const backends = [
      createBackend("backend-1"),
      createBackend("backend-2"),
      createBackend("backend-3"),
    ];

    const selected = Array.from(
      { length: 6 },
      () => getNextBackend(backends)?.name,
    );

    assert.deepEqual(selected, [
      "backend-1",
      "backend-2",
      "backend-3",
      "backend-1",
      "backend-2",
      "backend-3",
    ]);
  });

  it("selects the backend with the fewest active connections", () => {
    const backends = [
      createBackend("backend-1", 5),
      createBackend("backend-2", 2),
      createBackend("backend-3", 8),
    ];

    assert.equal(getLeastConnectionsBackend(backends)?.name, "backend-2");
  });

  it("returns only healthy backends", () => {
    const backends = [
      createBackend("backend-1", 0, true),
      createBackend("backend-2", 0, false),
      createBackend("backend-3", 0, true),
    ];

    assert.deepEqual(
      getHealthyBackends(backends).map((backend) => backend.name),
      ["backend-1", "backend-3"],
    );
  });

  it("selects only from backends accepted by the availability check", () => {
    const backends = [
      createBackend("backend-1"),
      createBackend("backend-2"),
      createBackend("backend-3"),
    ];

    const selected = selectBackend(
      backends,
      "least-connections",
      (backend) => backend.name !== "backend-2",
      () => "CLOSED",
    );

    assert.equal(selected?.name, "backend-1");
  });

  it("prioritizes an available HALF_OPEN backend", () => {
    const backends = [
      createBackend("backend-1", 0),
      createBackend("backend-2", 5),
    ];

    const selected = selectBackend(
      backends,
      "least-connections",
      () => true,
      (backend) => (backend.name === "backend-2" ? "HALF_OPEN" : "CLOSED"),
    );

    assert.equal(selected?.name, "backend-2");
  });
});
