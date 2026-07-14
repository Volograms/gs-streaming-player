import type { NetworkState } from "@6g-path/gaussian-player";

export type NetworkTelemetryListener = (state: Readonly<NetworkState>) => void;

export interface NetworkTelemetryProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCurrentState(): Readonly<NetworkState>;
  subscribe(listener: NetworkTelemetryListener): () => void;
}
