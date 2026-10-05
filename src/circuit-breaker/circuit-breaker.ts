import type { CircuitState } from "./types.js";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";

  private failureCount = 0;
  private halfOpenRequestInProgress = false;

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  private openedAt = 0;

  constructor(failureThreshold = 3, resetTimeout = 10_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
  }

  getState(): CircuitState {
    return this.state;
  }

  recordFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenRequestInProgress = false;
      this.state = "OPEN";
      this.openedAt = Date.now();

      console.log("Circuit state: OPEN");

      return;
    }

    if (this.state !== "CLOSED") {
      return;
    }

    this.failureCount++;

    console.log(
      `Circuit failure: ${this.failureCount}/${this.failureThreshold}`,
    );

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();

      console.log("Circuit state: OPEN");
    }
  }

  canRequest(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.openedAt;

      if (elapsed < this.resetTimeout) {
        return false;
      }

      this.state = "HALF_OPEN";
      this.halfOpenRequestInProgress = true;

      console.log("Circuit state: HALF_OPEN");

      return true;
    }

    if (this.state === "HALF_OPEN") {
      return false;
    }

    return false;
  }

  recordSuccess(): void {
    if (this.state !== "HALF_OPEN") {
      return;
    }

    this.failureCount = 0;
    this.halfOpenRequestInProgress = false;
    this.state = "CLOSED";

    console.log("Circuit state: CLOSED");
  }
}
