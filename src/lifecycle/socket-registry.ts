import type { Socket } from "node:net";

export class SocketRegistry {
  private readonly sockets = new Set<Socket>();

  get size(): number {
    return this.sockets.size;
  }

  track(socket: Socket): void {
    if (socket.destroyed || this.sockets.has(socket)) {
      return;
    }

    this.sockets.add(socket);

    socket.once("close", () => {
      this.sockets.delete(socket);
    });
  }

  destroyAll(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }
}
