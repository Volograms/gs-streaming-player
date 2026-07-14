import type { NetworkState } from "../network/types.js";
import type { PlaybackState } from "../player/playbackState.js";

export interface PlayerMetrics {
  downloadedBytes: number;
  droppedFrames: number;
  renderFramesPerSecond?: number;
  stallDurationSeconds: number;
}

export interface QualityDecision {
  renderSplatBudget: number;
  staticObjectWeight: number;
  dynamicObjectWeights: Record<string, number>;
  targetBufferSeconds: number;
  maximumRefinementBytes: number;
  allowStaticRefinement: boolean;
}

export interface QualityController {
  update(
    playback: Readonly<PlaybackState>,
    network: Readonly<NetworkState>,
    metrics: Readonly<PlayerMetrics>,
  ): QualityDecision;
}
