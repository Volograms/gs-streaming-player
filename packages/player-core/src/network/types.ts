export type NetworkStateSource =
  "fixed" | "client-measured" | "6g-telemetry" | "simulated";

export interface NetworkState {
  estimatedThroughputBps: number;
  rttMs?: number;
  packetLossRatio?: number;
  confidence?: number;
  source: NetworkStateSource;
  timestampMs: number;
}
