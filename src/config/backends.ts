import type { Backend, LoadBalancingStrategy } from "../load-balancer/index.js";

const backendHost = process.env.BACKEND_HOST ?? "localhost";

export const backends: Backend[] = [
  {
    host: backendHost,
    port: 9101,
    name: "backend-1",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: backendHost,
    port: 9102,
    name: "backend-2",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: backendHost,
    port: 9103,
    name: "backend-3",
    activeConnections: 0,
    healthy: true,
  },
];

export const PORT = 9000;
export const strategy: LoadBalancingStrategy = "round-robin";

export const PROXY_CONFIG = {
  backendSocketTimeout: 3000,
  maxRetries: 2,
} as const;
