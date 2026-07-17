import type { PackedFrameMemoryBenchmarkResult } from "@6g-path/gaussian-renderer-spark";

export interface PackedFrameMemoryBenchmarkControlsProps {
  disabled: boolean;
  error?: string;
  onRun(): void;
  result?: Readonly<PackedFrameMemoryBenchmarkResult>;
}

function formatMilliseconds(value: number): string {
  return value < 1 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function PackedFrameMemoryBenchmarkControls({
  disabled,
  error,
  onRun,
  result,
}: PackedFrameMemoryBenchmarkControlsProps) {
  return (
    <fieldset className="packed-memory-benchmark-controls">
      <legend>Packed-memory experiment</legend>
      <button disabled={disabled} onClick={onRun} type="button">
        Test current frame
      </button>
      {error === undefined ? null : <output data-state="error">{error}</output>}
      {result === undefined ? (
        <output>Pause on a decoded SPZ frame, then run the memory-layout test.</output>
      ) : (
        <output data-packed-memory-benchmark={JSON.stringify(result)}>
          {result.splatCount.toLocaleString()} splats · SH
          {result.sphericalHarmonicsDegree} · {formatMegabytes(result.payloadBytes)} raw
          · {result.iterations} passes
          <br />
          Snapshot {formatMilliseconds(result.snapshotDurationMs)} · clone p50/p95{" "}
          {formatMilliseconds(result.clone.medianMs)} /{" "}
          {formatMilliseconds(result.clone.p95Ms)}
          <br />
          Zero-copy bind p50/p95 {formatMilliseconds(result.bind.medianMs)} /{" "}
          {formatMilliseconds(result.bind.p95Ms)}
        </output>
      )}
    </fieldset>
  );
}
