import { summariseFrameTimings } from "@6g-path/gaussian-player";

import type {
  FrameRingBufferTraceEvent,
  TimingDistribution,
} from "@6g-path/gaussian-player";

export interface PlaybackPerformancePanelProps {
  events: readonly Readonly<FrameRingBufferTraceEvent>[];
}

function formatTiming(distribution: TimingDistribution): string {
  if (distribution.medianMs === undefined) {
    return "waiting";
  }
  return `${distribution.medianMs.toFixed(0)} / ${distribution.p95Ms?.toFixed(0) ?? "–"} ms`;
}

export function PlaybackPerformancePanel({ events }: PlaybackPerformancePanelProps) {
  const summary = summariseFrameTimings(events);
  const throughputMbps =
    summary.estimatedBaseThroughputBps === undefined
      ? undefined
      : summary.estimatedBaseThroughputBps / 1_000_000;

  return (
    <section
      className="performance-summary"
      aria-label="Playback performance summary"
      data-performance-summary={JSON.stringify(summary)}
    >
      <header>
        <span>Measured playback performance</span>
        <strong>{summary.sampleCount} base samples</strong>
      </header>
      <dl>
        <div>
          <dt>Queue p50 / p95</dt>
          <dd>{formatTiming(summary.queueWait)}</dd>
        </div>
        <div>
          <dt>Root-ready p50 / p95</dt>
          <dd>{formatTiming(summary.minimumRenderable)}</dd>
        </div>
        <div>
          <dt>Refinement p50 / p95</dt>
          <dd>{formatTiming(summary.refinement)}</dd>
        </div>
        <div>
          <dt>Handoff p50 / p95</dt>
          <dd>{formatTiming(summary.handoff)}</dd>
        </div>
        <div>
          <dt>Observed base throughput</dt>
          <dd>
            {throughputMbps === undefined
              ? "waiting"
              : `${throughputMbps.toFixed(1)} Mbps`}
          </dd>
        </div>
        <div>
          <dt>Observed switching rate</dt>
          <dd>
            {summary.switchingFramesPerSecond === undefined
              ? "waiting"
              : `${summary.switchingFramesPerSecond.toFixed(1)} fps`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
