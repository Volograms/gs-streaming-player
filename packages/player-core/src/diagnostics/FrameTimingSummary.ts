import type { FrameRingBufferTraceEvent } from "../buffering/types.js";

export interface TimingDistribution {
  count: number;
  maximumMs?: number;
  meanMs?: number;
  medianMs?: number;
  p95Ms?: number;
}

export interface FrameTimingSummary {
  basePreparation: TimingDistribution;
  codecDecode: TimingDistribution;
  compressedFetch: TimingDistribution;
  compressedFetchThroughputBps?: number;
  displayCommitCadence: TimingDistribution;
  displayCommitFramesPerSecond?: number;
  estimatedBaseThroughputBps?: number;
  flatFrameCopy: TimingDistribution;
  flatPack: TimingDistribution;
  flatPackBind: TimingDistribution;
  flatPackQueue: TimingDistribution;
  flatPackTransfer: TimingDistribution;
  flatPackWorker: TimingDistribution;
  flatDecode: TimingDistribution;
  handoff: TimingDistribution;
  minimumRenderable: TimingDistribution;
  presentationCadence: TimingDistribution;
  presentationWait: TimingDistribution;
  queueWait: TimingDistribution;
  refinement: TimingDistribution;
  renderCall: TimingDistribution;
  sampleCount: number;
  sort: TimingDistribution;
  sortOrderingUpload: TimingDistribution;
  sortReadback: TimingDistribution;
  sortWorker: TimingDistribution;
  sparkUpdate: TimingDistribution;
  switchingFramesPerSecond?: number;
}

function percentile(sorted: readonly number[], ratio: number): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function distribution(values: readonly number[]): TimingDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0 };
  }
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    maximumMs: sorted[sorted.length - 1]!,
    meanMs: total / sorted.length,
    medianMs: percentile(sorted, 0.5)!,
    p95Ms: percentile(sorted, 0.95)!,
  };
}

/** Reduces the bounded diagnostic event history into reproducible stage measurements. */
export function summariseFrameTimings(
  events: readonly Readonly<FrameRingBufferTraceEvent>[],
): FrameTimingSummary {
  const basePreparation: number[] = [];
  const codecDecode: number[] = [];
  const compressedFetch: number[] = [];
  const compressedFetchThroughputSamples: number[] = [];
  const displayCommitIntervals: number[] = [];
  const handoff: number[] = [];
  const flatFrameCopy: number[] = [];
  const flatPack: number[] = [];
  const flatPackBind: number[] = [];
  const flatPackQueue: number[] = [];
  const flatPackTransfer: number[] = [];
  const flatPackWorker: number[] = [];
  const flatDecode: number[] = [];
  const minimumRenderable: number[] = [];
  const presentationWait: number[] = [];
  const queueWait: number[] = [];
  const refinement: number[] = [];
  const renderCall: number[] = [];
  const renderIntervals: number[] = [];
  const sort: number[] = [];
  const sortOrderingUpload: number[] = [];
  const sortReadback: number[] = [];
  const sortWorker: number[] = [];
  const sparkUpdate: number[] = [];
  const presentationReadyAt = new Map<number, number>();
  const presentedAt: number[] = [];

  for (const event of events) {
    if (event.type === "base-started" && event.durationMs !== undefined) {
      queueWait.push(event.durationMs);
    }
    if (event.type === "base-ready" && event.durationMs !== undefined) {
      basePreparation.push(event.durationMs);
    }
    if (event.type === "codec-decode-ready" && event.durationMs !== undefined) {
      codecDecode.push(event.durationMs);
    }
    if (event.type === "compressed-fetch-ready" && event.durationMs !== undefined) {
      compressedFetch.push(event.durationMs);
      if (event.loadedBytes !== undefined && event.durationMs > 0) {
        compressedFetchThroughputSamples.push(
          (event.loadedBytes * 8_000) / event.durationMs,
        );
      }
    }
    if (event.type === "renderer-phase" && event.stageDurationMs !== undefined) {
      const target =
        event.phase === "flat-pack"
          ? flatPack
          : event.phase === "flat-pack-bind"
            ? flatPackBind
            : event.phase === "flat-pack-queue"
              ? flatPackQueue
              : event.phase === "flat-pack-transfer"
                ? flatPackTransfer
                : event.phase === "flat-pack-worker"
                  ? flatPackWorker
                  : undefined;
      target?.push(event.stageDurationMs);
    }
    if (
      event.type === "renderer-phase" &&
      event.phase === "minimum-renderable" &&
      event.durationMs !== undefined
    ) {
      minimumRenderable.push(event.durationMs);
    }
    if (
      event.type === "renderer-phase" &&
      event.phase === "flat-decode" &&
      event.stageDurationMs !== undefined
    ) {
      flatDecode.push(event.stageDurationMs);
    }
    if (event.type === "refinement-ready" && event.durationMs !== undefined) {
      refinement.push(event.durationMs);
    }
    if (
      event.type === "presentation-ready" &&
      event.frameIndex !== undefined &&
      event.durationMs !== undefined
    ) {
      presentationWait.push(event.durationMs);
      presentationReadyAt.set(event.frameIndex, event.atMs);
    }
    if (event.type === "presented") {
      presentedAt.push(event.atMs);
      if (event.frameIndex !== undefined) {
        const readyAt = presentationReadyAt.get(event.frameIndex);
        if (readyAt !== undefined) {
          handoff.push(Math.max(0, event.atMs - readyAt));
        }
      }
    }
    if (event.type === "render-timing") {
      displayCommitIntervals.push(
        ...(event.displayCommitIntervalsMs ?? []).filter((duration) => duration > 0),
      );
      flatFrameCopy.push(...(event.flatFrameCopySamplesMs ?? []));
      renderCall.push(...(event.renderCallSamplesMs ?? []));
      renderIntervals.push(
        ...(event.renderIntervalSamplesMs ?? []).filter((duration) => duration > 0),
      );
      sort.push(...(event.sortSamplesMs ?? []));
      sortOrderingUpload.push(...(event.sortOrderingUploadSamplesMs ?? []));
      sortReadback.push(...(event.sortReadbackSamplesMs ?? []));
      sortWorker.push(...(event.sortWorkerSamplesMs ?? []));
      sparkUpdate.push(...(event.sparkUpdateSamplesMs ?? []));
    }
  }

  const switchingDurations = presentedAt
    .slice(1)
    .map((timestamp, index) => timestamp - (presentedAt[index] ?? timestamp))
    .filter((duration) => duration > 0);
  const meanSwitchingDuration =
    switchingDurations.length === 0
      ? undefined
      : switchingDurations.reduce((sum, value) => sum + value, 0) /
        switchingDurations.length;
  const estimatedBaseThroughputBps =
    compressedFetchThroughputSamples.length === 0
      ? undefined
      : compressedFetchThroughputSamples.reduce((sum, value) => sum + value, 0) /
        compressedFetchThroughputSamples.length;
  const meanDisplayCommitInterval =
    displayCommitIntervals.length === 0
      ? undefined
      : displayCommitIntervals.reduce((sum, value) => sum + value, 0) /
        displayCommitIntervals.length;

  return {
    basePreparation: distribution(basePreparation),
    codecDecode: distribution(codecDecode),
    compressedFetch: distribution(compressedFetch),
    ...(estimatedBaseThroughputBps === undefined
      ? {}
      : { compressedFetchThroughputBps: estimatedBaseThroughputBps }),
    ...(estimatedBaseThroughputBps === undefined ? {} : { estimatedBaseThroughputBps }),
    displayCommitCadence: distribution(displayCommitIntervals),
    ...(meanDisplayCommitInterval === undefined
      ? {}
      : { displayCommitFramesPerSecond: 1_000 / meanDisplayCommitInterval }),
    flatFrameCopy: distribution(flatFrameCopy),
    flatPack: distribution(flatPack),
    flatPackBind: distribution(flatPackBind),
    flatPackQueue: distribution(flatPackQueue),
    flatPackTransfer: distribution(flatPackTransfer),
    flatPackWorker: distribution(flatPackWorker),
    flatDecode: distribution(flatDecode),
    handoff: distribution(handoff),
    minimumRenderable: distribution(minimumRenderable),
    presentationCadence: distribution(switchingDurations),
    presentationWait: distribution(presentationWait),
    queueWait: distribution(queueWait),
    refinement: distribution(refinement),
    renderCall: distribution(renderCall),
    sampleCount: basePreparation.length,
    sort: distribution(sort),
    sortOrderingUpload: distribution(sortOrderingUpload),
    sortReadback: distribution(sortReadback),
    sortWorker: distribution(sortWorker),
    sparkUpdate: distribution(sparkUpdate),
    ...(meanSwitchingDuration === undefined
      ? {}
      : { switchingFramesPerSecond: 1_000 / meanSwitchingDuration }),
  };
}
