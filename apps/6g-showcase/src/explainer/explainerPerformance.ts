export type ExplainerDiagnosticMode = "live" | "frozen" | "hidden";

export interface ExplainerUpdateTiming {
  snapshotMs: number;
  evaluateMs: number;
  applyMs: number;
  totalMs: number;
}

/** Bounded CPU samples; these do not measure asynchronous GPU work. */
export class ExplainerPerformance {
  private readonly samples: ExplainerUpdateTiming[] = [];

  record(sample: ExplainerUpdateTiming): void {
    this.samples.push(sample);
    if (this.samples.length > 120) this.samples.shift();
  }

  reset(): void {
    this.samples.length = 0;
  }

  get snapshot() {
    const percentile = (key: keyof ExplainerUpdateTiming) => {
      const values = this.samples.map((sample) => sample[key]).sort((a, b) => a - b);
      return values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
    };
    return {
      sampleCount: this.samples.length,
      snapshotMs: percentile("snapshotMs"),
      evaluateMs: percentile("evaluateMs"),
      applyMs: percentile("applyMs"),
      totalMs: percentile("totalMs"),
    };
  }
}
