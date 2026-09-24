import type { PlayerMetrics, QualityController, QualityDecision } from "./types.js";
import type { NetworkState } from "../network/types.js";
import type { PlaybackState } from "../player/playbackState.js";

export type BufferQualityTier = "critical" | "constrained" | "balanced" | "high";

export interface DynamicQualityLevel {
  detailLevel: number;
  estimatedFrameBytes?: number;
}

export interface BufferAwareQualityControllerConfiguration {
  dynamicObjectId: string;
  /** Authored, independently addressable tiers, already filtered to the playable floor. */
  dynamicQualityLevels?: readonly DynamicQualityLevel[];
  /** Never request a dynamic transfer tier below this detail level. */
  minimumDynamicDetailLevel?: number;
  minimumSplatCount?: number;
  safetyFactor?: number;
  targetBufferSeconds?: number;
  upgradeObservationCount?: number;
  /** Sustained headroom required before each authored-tier upgrade. */
  upgradeDelayMs?: number;
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
  private readonly configuration: Required<
    Omit<BufferAwareQualityControllerConfiguration, "dynamicQualityLevels">
  >;
  private readonly levels: readonly DynamicQualityLevel[] | undefined;
  private levelIndex = 0;
  private upgradeStartedAt: number | undefined;
  private lastObservationAt = -Infinity;
  private lastSwitchAt = -Infinity;
  private renderPressureStartedAt: number | undefined;
  private previousDroppedFrames = 0;
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
      upgradeDelayMs: configuration.upgradeDelayMs ?? 2_000,
    };
    this.levels = configuration.dynamicQualityLevels
      ?.map((level) => ({ ...level }))
      .sort((left, right) => left.detailLevel - right.detailLevel);
    if (
      this.levels !== undefined &&
      (this.levels.length === 0 ||
        this.levels.some(
          (level, index) =>
            !Number.isFinite(level.detailLevel) ||
            level.detailLevel <= 0 ||
            level.detailLevel > 1 ||
            (index > 0 && level.detailLevel <= this.levels![index - 1]!.detailLevel) ||
            (level.estimatedFrameBytes !== undefined &&
              (!Number.isFinite(level.estimatedFrameBytes) ||
                level.estimatedFrameBytes <= 0)),
        ))
    )
      throw new RangeError(
        "dynamicQualityLevels must contain distinct valid detail levels and positive frame bytes.",
      );
    if (
      !Number.isFinite(this.configuration.upgradeDelayMs) ||
      this.configuration.upgradeDelayMs < 0
    )
      throw new RangeError("upgradeDelayMs must be a non-negative finite number.");
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
    if (this.levels !== undefined) {
      this.updateAuthoredLevel(playback, network, metrics);
      return this.decision(this.levels[this.levelIndex]!.detailLevel);
    }
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

    return this.decision(tierConfiguration[this.tierValue].detailLevel);
  }

  private decision(detailLevel: number): QualityDecision {
    const tier = tierConfiguration[this.tierValue];
    return {
      allowStaticRefinement: this.tierValue !== "critical",
      dynamicFrameDetailLevel: Math.max(
        detailLevel,
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

  private updateAuthoredLevel(
    playback: Readonly<PlaybackState>,
    network: Readonly<NetworkState>,
    metrics: Readonly<PlayerMetrics>,
  ): void {
    const now = metrics.timestampMs ?? network.timestampMs;
    const fresh = now > this.lastObservationAt;
    this.lastObservationAt = Math.max(now, this.lastObservationAt);
    const dropped = metrics.droppedFrames > this.previousDroppedFrames;
    this.previousDroppedFrames = metrics.droppedFrames;
    if (
      !playback.isPlaying ||
      (playback.lifecycle !== "PLAYING" && playback.lifecycle !== "BUFFERING")
    ) {
      this.resetUpgrade();
      this.renderPressureStartedAt = undefined;
      return;
    }
    const levels = this.levels!;
    const fps = metrics.targetFramesPerSecond ?? 30;
    const capacity = metrics.bufferCapacitySeconds;
    const target =
      capacity !== undefined && capacity > 0
        ? Math.min(this.configuration.targetBufferSeconds, capacity * 0.7)
        : this.configuration.targetBufferSeconds;
    const bufferRatio = playback.bufferAheadSeconds / target;
    const measuredNetwork =
      network.estimatedThroughputBps > 0 && network.confidence !== 0;
    const safeThroughput =
      network.estimatedThroughputBps * this.configuration.safetyFactor;
    let affordable = this.levelIndex;
    if (measuredNetwork) {
      affordable = 0;
      for (const [index, level] of levels.entries()) {
        if (
          level.estimatedFrameBytes === undefined ||
          level.estimatedFrameBytes * fps * 8 > safeThroughput
        )
          break;
        affordable = index;
      }
    }
    const renderSlow = (metrics.renderFramesPerSecond ?? fps) < fps;
    if (renderSlow) this.renderPressureStartedAt ??= now;
    else this.renderPressureStartedAt = undefined;
    const renderPressure =
      dropped ||
      (this.renderPressureStartedAt !== undefined &&
        now - this.renderPressureStartedAt >= 750);
    const critical =
      bufferRatio < 0.34 ||
      (playback.lifecycle === "BUFFERING" &&
        playback.bufferAheadSeconds < playback.minimumReadyFrames / fps);
    let nextIndex = this.levelIndex;
    if (critical) nextIndex = 0;
    else if (measuredNetwork && affordable < nextIndex) nextIndex = affordable;
    else if ((bufferRatio < 0.75 || renderPressure) && now - this.lastSwitchAt >= 1_000)
      nextIndex -= 1;
    nextIndex = Math.max(0, nextIndex);
    if (nextIndex < this.levelIndex) {
      this.levelIndex = nextIndex;
      this.lastSwitchAt = now;
      this.resetUpgrade();
    } else if (
      !critical &&
      bufferRatio >= 1 &&
      !renderSlow &&
      !dropped &&
      measuredNetwork &&
      affordable > this.levelIndex
    ) {
      if (fresh) {
        this.upgradeStartedAt ??= now;
        this.pendingUpgradeCount += 1;
      }
      if (
        this.upgradeStartedAt !== undefined &&
        now - this.upgradeStartedAt >= this.configuration.upgradeDelayMs &&
        now - this.lastSwitchAt >= this.configuration.upgradeDelayMs &&
        this.pendingUpgradeCount >= this.configuration.upgradeObservationCount
      ) {
        this.levelIndex += 1;
        this.lastSwitchAt = now;
        this.resetUpgrade();
      }
    } else this.resetUpgrade();
    this.tierValue = critical
      ? "critical"
      : this.levelIndex === levels.length - 1
        ? "high"
        : this.levelIndex === 0
          ? "constrained"
          : "balanced";
  }

  private resetUpgrade(): void {
    this.pendingUpgradeCount = 0;
    this.upgradeStartedAt = undefined;
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
