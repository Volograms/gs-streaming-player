import type { NetworkState } from "../network/types.js";
import type { PlaybackState } from "../player/playbackState.js";

export interface PlayerMetrics {
  bufferOccupancyRatio?: number;
  downloadedBytes: number;
  droppedFrames: number;
  estimatedBaseFrameBytes?: number;
  renderFramesPerSecond?: number;
  stallDurationSeconds: number;
  targetFramesPerSecond?: number;
  timeUntilNextDeadlineSeconds?: number;
}

export interface QualityDecision {
  renderSplatBudget: number;
  staticObjectWeight: number;
  dynamicObjectWeights: Record<string, number>;
  targetBufferSeconds: number;
  maximumRefinementBytes: number;
  allowStaticRefinement: boolean;
  dynamicFrameDetailLevel?: number;
  maximumBasePreparationConcurrency?: number;
  maximumRefinementConcurrency?: number;
  minimumDynamicSplatCount?: number;
}

export interface QualityController {
  update(
    playback: Readonly<PlaybackState>,
    network: Readonly<NetworkState>,
    metrics: Readonly<PlayerMetrics>,
  ): QualityDecision;
}
