import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";

import { SocketRegistry } from "../../src/lifecycle/socket-registry.js";

describe("Socket Registry", () => {
  it("starts with no tracked sockets", () => {
    const registry = new SocketRegistry();

    assert.equal(registry.size, 0);
  });

  it("tracks a socket", async () => {
    const registry = new SocketRegistry();
    const socket = new net.Socket();

    try {
      registry.track(socket);

      assert.equal(registry.size, 1);
    } finally {
      const closed = once(socket, "close");

      socket.destroy();

      await closed;
    }
  });

  it("does not track the same socket multiple times", async () => {
    const registry = new SocketRegistry();
    const socket = new net.Socket();

    try {
      registry.track(socket);
      registry.track(socket);
      registry.track(socket);

      assert.equal(registry.size, 1);
      assert.equal(socket.listenerCount("close"), 1);
    } finally {
      const closed = once(socket, "close");

      socket.destroy();

      await closed;
    }
  });

  it("removes a socket when it closes", async () => {
    const registry = new SocketRegistry();
    const socket = new net.Socket();

    registry.track(socket);

    assert.equal(registry.size, 1);

    const closed = once(socket, "close");

    socket.destroy();

    await closed;

    assert.equal(registry.size, 0);
  });

  it("does not track an already destroyed socket", async () => {
    const registry = new SocketRegistry();
    const socket = new net.Socket();

    const closed = once(socket, "close");

    socket.destroy();

    await closed;

    registry.track(socket);

    assert.equal(registry.size, 0);
  });

  it("destroys all tracked sockets", async () => {
    const registry = new SocketRegistry();

    const sockets = [new net.Socket(), new net.Socket(), new net.Socket()];

    for (const socket of sockets) {
      registry.track(socket);
    }

    assert.equal(registry.size, 3);

    const closed = Promise.all(sockets.map((socket) => once(socket, "close")));

    registry.destroyAll();

    await closed;

    assert.ok(sockets.every((socket) => socket.destroyed));
    assert.equal(registry.size, 0);
  });

  it("allows destroyAll to be called multiple times", async () => {
    const registry = new SocketRegistry();
    const socket = new net.Socket();

    registry.track(socket);

    const closed = once(socket, "close");

    registry.destroyAll();
    registry.destroyAll();

    await closed;

    registry.destroyAll();

    assert.equal(socket.destroyed, true);
    assert.equal(registry.size, 0);
  });

  it("tracks the lifecycle of multiple sockets independently", async () => {
    const registry = new SocketRegistry();

    const first = new net.Socket();
    const second = new net.Socket();

    registry.track(first);
    registry.track(second);

    try {
      assert.equal(registry.size, 2);

      const firstClosed = once(first, "close");

      first.destroy();

      await firstClosed;

      assert.equal(registry.size, 1);
      assert.equal(second.destroyed, false);

      const secondClosed = once(second, "close");

      second.destroy();

      await secondClosed;

      assert.equal(registry.size, 0);
    } finally {
      registry.destroyAll();
    }
  });
});
