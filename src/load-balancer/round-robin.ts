import type { Backend } from "./types.js";

let currentIndex = 0;

export function getNextBackend(backends: Backend[]): Backend | undefined {
  if (backends.length === 0) {
    return undefined;
  }

  const backend = backends[currentIndex % backends.length];

  currentIndex = (currentIndex + 1) % backends.length;

  return backend;
}
