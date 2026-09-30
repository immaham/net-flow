export type Backend = {
  host: string;
  port: number;
  name: string;
  activeConnections: number;
  healthy: boolean;
};

export type LoadBalancingStrategy = "round-robin" | "least-connections";
