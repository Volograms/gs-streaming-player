import type { NetworkState } from "./types.js";

export interface ClientThroughputEstimatorConfiguration {
  longWindowSize?: number;
  shortWindowSize?: number;
}

interface ThroughputSample {
  bitsPerSecond: number;
  timestampMs: number;
}

/** Multi-window estimator that reacts quickly while retaining a conservative baseline. */
export class ClientThroughputEstimator {
  private readonly longWindowSize: number;
  private readonly samples: ThroughputSample[] = [];
  private readonly shortWindowSize: number;

  constructor(configuration: ClientThroughputEstimatorConfiguration = {}) {
    this.shortWindowSize = configuration.shortWindowSize ?? 4;
    this.longWindowSize = configuration.longWindowSize ?? 16;
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
      bitsPerSecond: (byteCount * 8_000) / durationMs,
      timestampMs,
    });
    if (this.samples.length > this.longWindowSize) {
      this.samples.splice(0, this.samples.length - this.longWindowSize);
    }
  }

  getState(timestampMs: number): NetworkState | undefined {
    if (this.samples.length === 0) {
      return undefined;
    }
    const shortSamples = this.samples.slice(-this.shortWindowSize);
    const shortMean = this.mean(shortSamples);
    const longMean = this.mean(this.samples);
    const mean = Math.min(shortMean, longMean);
    const variance =
      this.samples.reduce(
        (sum, sample) => sum + Math.pow(sample.bitsPerSecond - longMean, 2),
        0,
      ) / this.samples.length;
    const coefficientOfVariation = longMean <= 0 ? 1 : Math.sqrt(variance) / longMean;
    const sampleConfidence = Math.min(1, this.samples.length / this.longWindowSize);
    const stabilityConfidence = Math.max(0, 1 - coefficientOfVariation);
    return {
      confidence: sampleConfidence * stabilityConfidence,
      estimatedThroughputBps: mean,
      source: "client-measured",
      timestampMs,
    };
  }

  private mean(samples: readonly ThroughputSample[]): number {
    return (
      samples.reduce((sum, sample) => sum + sample.bitsPerSecond, 0) / samples.length
    );
  }
}
