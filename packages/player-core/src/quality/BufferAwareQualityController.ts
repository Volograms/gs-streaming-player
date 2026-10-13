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
  private fillingCompressedReserveAfterUpgrade = false;
  private compressedReserveWarmupPeak = 0;
  private compressedReserveGrowthAt = -Infinity;
  private upgradeStartedAt: number | undefined;
  private lastObservationAt = -Infinity;
  private lastSwitchAt = -Infinity;
  private renderPressureStartedAt: number | undefined;
  private previousDroppedFrames = 0;
  private recentDrops: Array<{ at: number; count: number }> = [];
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
    const dropped = Math.max(0, metrics.droppedFrames - this.previousDroppedFrames);
    this.previousDroppedFrames = metrics.droppedFrames;
    if (
      !playback.isPlaying ||
      (playback.lifecycle !== "PLAYING" && playback.lifecycle !== "BUFFERING")
    ) {
      this.resetUpgrade();
      this.renderPressureStartedAt = undefined;
      this.recentDrops = [];
      if (
        playback.lifecycle === "READY" ||
        playback.lifecycle === "PAUSED" ||
        playback.lifecycle === "ENDED"
      ) {
        // Paused content has no presentation deadline. Use idle time to prepare
        // the best available tier; playback will re-evaluate delivery pressure.
        const available = this.levels!.map((level, index) => ({ level, index })).filter(
          ({ level }) =>
            metrics.availableDynamicDetailLevels?.includes(level.detailLevel) ?? true,
        );
        this.levelIndex = available.at(-1)?.index ?? this.levelIndex;
        this.tierValue =
          this.levelIndex === this.levels!.length - 1 ? "high" : "balanced";
      }
      return;
    }
    const levels = this.levels!;
    const available = levels
      .map((level, index) => ({ level, index }))
      .filter(
        ({ level }) =>
          metrics.availableDynamicDetailLevels?.includes(level.detailLevel) ?? true,
      );
    const floorIndex = available[0]?.index ?? 0;
    const isAvailable = (index: number) =>
      available.some((candidate) => candidate.index === index);
    const fps = metrics.targetFramesPerSecond ?? 30;
    this.recentDrops = this.recentDrops.filter(({ at }) => now - at < 1_000);
    if (dropped > 0) this.recentDrops.push({ at: now, count: dropped });
    // An isolated late frame is not evidence that a higher transfer tier cannot
    // decode in time. React to sustained loss, while retaining the readiness gate.
    const dropPressure =
      this.recentDrops.reduce((sum, item) => sum + item.count, 0) >
      Math.max(1, fps * 0.05);
    const capacity = metrics.bufferCapacitySeconds;
    const target =
      capacity !== undefined && capacity > 0
        ? Math.min(this.configuration.targetBufferSeconds, capacity * 0.7)
        : this.configuration.targetBufferSeconds;
    const startupReserve = Math.min(
      target,
      Math.max(2, playback.minimumReadyFrames) / fps,
    );
    const decodedPressure =
      playback.bufferAheadSeconds < Math.min(target, Math.max(startupReserve, 0.25));
    const measuredNetwork =
      network.estimatedThroughputBps > 0 && network.confidence !== 0;
    const safeThroughput =
      network.estimatedThroughputBps * this.configuration.safetyFactor;
    const compressedTarget = Math.min(
      this.configuration.targetBufferSeconds,
      metrics.compressedBufferWindowSeconds ?? Infinity,
    );
    const compressedRatio =
      metrics.compressedBufferAheadSeconds === undefined || compressedTarget <= 0
        ? 1
        : metrics.compressedBufferAheadSeconds / compressedTarget;
    if (compressedRatio >= 1) this.fillingCompressedReserveAfterUpgrade = false;
    else if (this.fillingCompressedReserveAfterUpgrade) {
      const reserve = metrics.compressedBufferAheadSeconds ?? 0;
      if (reserve > this.compressedReserveWarmupPeak + 1 / fps) {
        this.compressedReserveWarmupPeak = reserve;
        this.compressedReserveGrowthAt = now;
      } else if (now - this.compressedReserveGrowthAt >= 2_000) {
        this.fillingCompressedReserveAfterUpgrade = false;
      }
    }
    let affordable = isAvailable(this.levelIndex) ? this.levelIndex : floorIndex;
    if (measuredNetwork) {
      affordable = floorIndex;
      for (const { index, level } of available) {
        if (
          level.estimatedFrameBytes === undefined ||
          level.estimatedFrameBytes * fps * 8 > safeThroughput ||
          (metrics.estimatedPreparationBytesPerSecond !== undefined &&
            level.estimatedFrameBytes * fps >
              metrics.estimatedPreparationBytesPerSecond *
                this.configuration.safetyFactor) ||
          (metrics.compressedBufferCapacityBytes !== undefined &&
            // Include the current payload as well as the future reserve.
            level.estimatedFrameBytes *
              Math.min(
                Math.ceil(compressedTarget * fps) + 1,
                Math.ceil((metrics.compressedBufferWindowSeconds ?? Infinity) * fps),
              ) >
              metrics.compressedBufferCapacityBytes)
        )
          break;
        affordable = index;
      }
    }
    const renderSlow = (metrics.renderFramesPerSecond ?? fps) < fps;
    if (renderSlow) this.renderPressureStartedAt ??= now;
    else this.renderPressureStartedAt = undefined;
    const renderPressure =
      dropPressure ||
      (this.renderPressureStartedAt !== undefined &&
        now - this.renderPressureStartedAt >= 750);
    const critical =
      playback.bufferAheadSeconds < startupReserve / 2 ||
      (playback.lifecycle === "BUFFERING" &&
        playback.bufferAheadSeconds < playback.minimumReadyFrames / fps);
    let nextIndex = this.levelIndex;
    if (!isAvailable(nextIndex)) nextIndex = affordable;
    else if (critical) nextIndex = floorIndex;
    else if (
      measuredNetwork &&
      affordable < nextIndex &&
      (metrics.compressedBufferAheadSeconds === undefined ||
        decodedPressure ||
        (!this.fillingCompressedReserveAfterUpgrade && compressedRatio < 0.9))
    )
      nextIndex = affordable;
    else if (
      (decodedPressure ||
        ((metrics.compressedBufferAheadSeconds ?? Infinity) <
          Math.min(0.5, compressedTarget) &&
          !this.fillingCompressedReserveAfterUpgrade) ||
        renderPressure) &&
      now - this.lastSwitchAt >= 1_000
    )
      nextIndex -= 1;
    nextIndex =
      available.filter(({ index }) => index <= nextIndex).at(-1)?.index ?? floorIndex;
    if (!isAvailable(this.levelIndex) || nextIndex < this.levelIndex) {
      this.levelIndex = nextIndex;
      this.fillingCompressedReserveAfterUpgrade = false;
      this.lastSwitchAt = now;
      this.resetUpgrade();
    } else if (
      !critical &&
      playback.bufferAheadSeconds >= startupReserve &&
      (metrics.compressedBufferAheadSeconds ?? Infinity) >=
        Math.min(0.5, compressedTarget) &&
      !renderSlow &&
      !dropPressure &&
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
        this.levelIndex = affordable;
        // The new tier's bytes are initially cold. Keep filling its reserve while
        // throughput, decoded readiness and rendering still support playback.
        this.fillingCompressedReserveAfterUpgrade =
          metrics.compressedBufferAheadSeconds !== undefined;
        this.compressedReserveWarmupPeak = 0;
        this.compressedReserveGrowthAt = now;
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
