import type { NetworkState } from "./types.js";

export interface ClientThroughputEstimatorConfiguration {
  longWindowSize?: number;
  shortWindowSize?: number;
  maximumSampleAgeMs?: number;
}

interface ThroughputSample {
  byteCount: number;
  startedAtMs: number;
  endedAtMs: number;
}

/** Multi-window estimator that reacts quickly while retaining a conservative baseline. */
export class ClientThroughputEstimator {
  private readonly longWindowSize: number;
  private readonly samples: ThroughputSample[] = [];
  private readonly shortWindowSize: number;
  private readonly maximumSampleAgeMs: number;

  constructor(configuration: ClientThroughputEstimatorConfiguration = {}) {
    this.shortWindowSize = configuration.shortWindowSize ?? 4;
    this.longWindowSize = configuration.longWindowSize ?? 16;
    this.maximumSampleAgeMs = configuration.maximumSampleAgeMs ?? 10_000;
    if (!Number.isFinite(this.maximumSampleAgeMs) || this.maximumSampleAgeMs <= 0) {
      throw new RangeError("maximumSampleAgeMs must be a positive finite number.");
    }
    if (
      !Number.isInteger(this.shortWindowSize) ||
      this.shortWindowSize <= 0 ||
      !Number.isInteger(this.longWindowSize) ||
      this.longWindowSize < this.shortWindowSize
    ) {
      throw new RangeError(
        "Throughput windows must be positive integers and the long window cannot be smaller than the short window.",
      );
    }
  }

  observe(byteCount: number, durationMs: number, timestampMs: number): void {
    if (
      !Number.isFinite(byteCount) ||
      byteCount <= 0 ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(timestampMs)
    ) {
      return;
    }
    this.samples.push({
      byteCount,
      startedAtMs: timestampMs - durationMs,
      endedAtMs: timestampMs,
    });
    this.samples.sort((left, right) => left.endedAtMs - right.endedAtMs);
    if (this.samples.length > this.longWindowSize) {
      this.samples.splice(0, this.samples.length - this.longWindowSize);
    }
  }

  getState(timestampMs: number): NetworkState | undefined {
    const samples = this.samples.filter(
      (sample) =>
        sample.endedAtMs <= timestampMs &&
        timestampMs - sample.endedAtMs <= this.maximumSampleAgeMs,
    );
    if (samples.length === 0) {
      return undefined;
    }
    // Include every transfer overlapping the short interval, even if more than
    // shortWindowSize requests finish together. Concurrency is delivery capacity.
    const shortStart = Math.min(
      ...samples.slice(-this.shortWindowSize).map((sample) => sample.startedAtMs),
    );
    const shortMean = this.aggregate(samples, shortStart);
    const longMean = this.aggregate(
      samples,
      Math.min(...samples.map((sample) => sample.startedAtMs)),
    );
    const mean = Math.min(shortMean, longMean);
    const sampleConfidence = Math.min(1, samples.length / this.longWindowSize);
    const stabilityConfidence =
      Math.min(shortMean, longMean) / Math.max(shortMean, longMean);
    const freshness = Math.max(
      0,
      1 - (timestampMs - samples.at(-1)!.endedAtMs) / this.maximumSampleAgeMs,
    );
    return {
      confidence: sampleConfidence * stabilityConfidence * freshness,
      estimatedThroughputBps: mean,
      source: "client-measured",
      timestampMs,
    };
  }

  private aggregate(samples: readonly ThroughputSample[], sinceMs: number): number {
    const intervals = samples
      .filter((sample) => sample.endedAtMs > sinceMs)
      .map((sample) => ({
        ...sample,
        clippedStart: Math.max(sinceMs, sample.startedAtMs),
      }))
      .sort((left, right) => left.clippedStart - right.clippedStart);
    let bytes = 0;
    let activeMs = 0;
    let previousEnd = -Infinity;
    for (const sample of intervals) {
      bytes +=
        (sample.byteCount * (sample.endedAtMs - sample.clippedStart)) /
        (sample.endedAtMs - sample.startedAtMs);
      activeMs += Math.max(
        0,
        sample.endedAtMs - Math.max(previousEnd, sample.clippedStart),
      );
      previousEnd = Math.max(previousEnd, sample.endedAtMs);
    }
    // Exclude intentional idle gaps between batches; overlapping wall time counts once.
    return activeMs > 0 ? (bytes * 8_000) / activeMs : 0;
  }
}
