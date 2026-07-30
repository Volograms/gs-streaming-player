import type { PlayerMetrics, QualityController, QualityDecision } from "./types.js";
import type { NetworkState } from "../network/types.js";
import type { PlaybackState } from "../player/playbackState.js";

export type BufferQualityTier = "critical" | "constrained" | "balanced" | "high";

export interface BufferAwareQualityControllerConfiguration {
  dynamicObjectId: string;
  /** Never request a dynamic transfer tier below this detail level. */
  minimumDynamicDetailLevel?: number;
  minimumSplatCount?: number;
  safetyFactor?: number;
  targetBufferSeconds?: number;
  upgradeObservationCount?: number;
}

const tierRank: Record<BufferQualityTier, number> = {
  critical: 0,
  constrained: 1,
  balanced: 2,
  high: 3,
};

const tierConfiguration: Record<
  BufferQualityTier,
  {
    baseConcurrency: number;
    detailLevel: number;
    refinementConcurrency: number;
    renderSplatBudget: number;
    staticWeight: number;
  }
> = {
  balanced: {
    baseConcurrency: 2,
    detailLevel: 0.25,
    refinementConcurrency: 1,
    renderSplatBudget: 1_500_000,
    staticWeight: 0.8,
  },
  constrained: {
    baseConcurrency: 2,
    detailLevel: 0.15,
    refinementConcurrency: 1,
    renderSplatBudget: 1_000_000,
    staticWeight: 0.55,
  },
  critical: {
    baseConcurrency: 1,
    detailLevel: 0.1,
    refinementConcurrency: 1,
    renderSplatBudget: 650_000,
    staticWeight: 0.3,
  },
  high: {
    baseConcurrency: 3,
    detailLevel: 0.4,
    refinementConcurrency: 2,
    renderSplatBudget: 2_000_000,
    staticWeight: 1,
  },
};

/** Conservative buffer/throughput policy with immediate downgrade and delayed upgrade. */
export class BufferAwareQualityController implements QualityController {
  private readonly configuration: Required<BufferAwareQualityControllerConfiguration>;
  private pendingUpgradeCount = 0;
  private tierValue: BufferQualityTier = "balanced";

  constructor(configuration: BufferAwareQualityControllerConfiguration) {
    this.configuration = {
      dynamicObjectId: configuration.dynamicObjectId,
      minimumDynamicDetailLevel: configuration.minimumDynamicDetailLevel ?? 0,
      minimumSplatCount: configuration.minimumSplatCount ?? 2,
      safetyFactor: configuration.safetyFactor ?? 0.75,
      targetBufferSeconds: configuration.targetBufferSeconds ?? 0.2,
      upgradeObservationCount: configuration.upgradeObservationCount ?? 3,
    };
    if (
      !Number.isFinite(this.configuration.safetyFactor) ||
      this.configuration.safetyFactor <= 0 ||
      this.configuration.safetyFactor > 1
    ) {
      throw new RangeError("safetyFactor must be greater than zero and at most one.");
    }
    if (this.configuration.dynamicObjectId.length === 0) {
      throw new RangeError("dynamicObjectId cannot be empty.");
    }
    if (
      !Number.isFinite(this.configuration.minimumDynamicDetailLevel) ||
      this.configuration.minimumDynamicDetailLevel < 0 ||
      this.configuration.minimumDynamicDetailLevel > 1
    ) {
      throw new RangeError("minimumDynamicDetailLevel must be between zero and one.");
    }
    if (
      !Number.isInteger(this.configuration.minimumSplatCount) ||
      this.configuration.minimumSplatCount <= 0
    ) {
      throw new RangeError("minimumSplatCount must be a positive integer.");
    }
    if (
      !Number.isFinite(this.configuration.targetBufferSeconds) ||
      this.configuration.targetBufferSeconds <= 0
    ) {
      throw new RangeError("targetBufferSeconds must be a positive finite number.");
    }
    if (
      !Number.isInteger(this.configuration.upgradeObservationCount) ||
      this.configuration.upgradeObservationCount <= 0
    ) {
      throw new RangeError("upgradeObservationCount must be a positive integer.");
    }
  }

  get tier(): BufferQualityTier {
    return this.tierValue;
  }

  update(
    playback: Readonly<PlaybackState>,
    network: Readonly<NetworkState>,
    metrics: Readonly<PlayerMetrics>,
  ): QualityDecision {
    const candidate = this.selectTier(playback, network, metrics);
    if (tierRank[candidate] < tierRank[this.tierValue]) {
      this.tierValue = candidate;
      this.pendingUpgradeCount = 0;
    } else if (tierRank[candidate] > tierRank[this.tierValue]) {
      this.pendingUpgradeCount += 1;
      if (this.pendingUpgradeCount >= this.configuration.upgradeObservationCount) {
        this.tierValue = candidate;
        this.pendingUpgradeCount = 0;
      }
    } else {
      this.pendingUpgradeCount = 0;
    }

    const tier = tierConfiguration[this.tierValue];
    return {
      allowStaticRefinement: this.tierValue !== "critical",
      dynamicFrameDetailLevel: Math.max(
        tier.detailLevel,
        this.configuration.minimumDynamicDetailLevel,
      ),
      dynamicObjectWeights: { [this.configuration.dynamicObjectId]: 1 },
      maximumBasePreparationConcurrency: tier.baseConcurrency,
      maximumRefinementBytes: Number.POSITIVE_INFINITY,
      maximumRefinementConcurrency: tier.refinementConcurrency,
      minimumDynamicSplatCount: this.configuration.minimumSplatCount,
      renderSplatBudget: tier.renderSplatBudget,
      staticObjectWeight: tier.staticWeight,
      targetBufferSeconds: this.configuration.targetBufferSeconds,
    };
  }

  private selectTier(
    playback: Readonly<PlaybackState>,
    network: Readonly<NetworkState>,
    metrics: Readonly<PlayerMetrics>,
  ): BufferQualityTier {
    const targetBufferSeconds = this.configuration.targetBufferSeconds;
    const bufferRatio = playback.bufferAheadSeconds / targetBufferSeconds;
    const frameBytes = metrics.estimatedBaseFrameBytes;
    const framesPerSecond = metrics.targetFramesPerSecond;
    const requiredThroughputBps =
      frameBytes === undefined || framesPerSecond === undefined
        ? undefined
        : frameBytes * framesPerSecond * 8;
    const throughputRatio =
      requiredThroughputBps === undefined || requiredThroughputBps <= 0
        ? Number.POSITIVE_INFINITY
        : (network.estimatedThroughputBps * this.configuration.safetyFactor) /
          requiredThroughputBps;

    if (playback.lifecycle === "BUFFERING" || bufferRatio < 0.34) {
      return "critical";
    }
    if (bufferRatio < 0.75 || throughputRatio < 1) {
      return "constrained";
    }
    if (
      bufferRatio >= 1.5 &&
      throughputRatio >= 1.75 &&
      (metrics.renderFramesPerSecond ?? framesPerSecond ?? 30) >=
        (framesPerSecond ?? 30)
    ) {
      return "high";
    }
    return "balanced";
  }
}
