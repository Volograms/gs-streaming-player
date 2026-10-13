import type { NetworkState } from "../network/types.js";
import type { PlaybackState } from "../player/playbackState.js";

export interface PlayerMetrics {
  /** Monotonic observation time; repeated callbacks at the same time are one sample. */
  timestampMs?: number;
  bufferOccupancyRatio?: number;
  /** Attainable forward reserve, accounting for the configured window and clip end. */
  bufferCapacitySeconds?: number;
  /** Downloaded/presentation-ready contiguous reserve, separate from the decoded ring. */
  compressedBufferAheadSeconds?: number;
  /** Compressed memory budget available for independently addressable frame tiers. */
  compressedBufferCapacityBytes?: number;
  /** Remaining clip duration, or one complete cycle when looping. */
  compressedBufferWindowSeconds?: number;
  /** Remaining common authored tiers after missing assets have been excluded. */
  availableDynamicDetailLevels?: readonly number[];
  downloadedBytes: number;
  droppedFrames: number;
  estimatedBaseFrameBytes?: number;
  /** Measured active decoder/renderer preparation capacity, including configured concurrency. */
  estimatedPreparationBytesPerSecond?: number;
  /** Actual displayed transfer tier; a downgrade may still be draining a higher-tier reserve. */
  presentedDynamicDetailLevel?: number;
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
