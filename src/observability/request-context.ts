import crypto from "node:crypto";

export type RequestContext = {
  id: string;
  startedAt: number;
};

export function createRequestContext(): RequestContext {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
  };
}
