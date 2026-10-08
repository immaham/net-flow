export type FaultConfig = {
  enabled: boolean;
  latencyMs: number;
  failureRate: number;
};

export const faultConfig: FaultConfig = {
  enabled: false,
  latencyMs: 0,
  failureRate: 0,
};

export function updateFaultConfig(updates: Partial<FaultConfig>) {
  Object.assign(faultConfig, updates);
}
