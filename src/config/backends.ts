import type { Backend, LoadBalancingStrategy } from "../load-balancer/index.js";

export const backends: Backend[] = [
  {
    host: "localhost",
    port: 9101,
    name: "backend-1",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: "localhost",
    port: 9102,
    name: "backend-2",
    activeConnections: 0,
    healthy: true,
  },
  {
    host: "localhost",
    port: 9103,
    name: "backend-3",
    activeConnections: 0,
    healthy: true,
  },
];

export const PORT = 9000;
export const strategy: LoadBalancingStrategy = "round-robin";
