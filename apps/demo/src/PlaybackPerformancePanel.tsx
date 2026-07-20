import { summariseFrameTimings } from "@6g-path/gaussian-player";

import type {
  FrameRingBufferTraceEvent,
  SequencePlaybackSnapshot,
  TimingDistribution,
} from "@6g-path/gaussian-player";

export interface PlaybackPerformancePanelProps {
  events: readonly Readonly<FrameRingBufferTraceEvent>[];
  playback?: Readonly<SequencePlaybackSnapshot>;
}

function formatTiming(distribution: TimingDistribution): string {
  if (distribution.medianMs === undefined) {
    return "waiting";
  }
  return `${distribution.medianMs.toFixed(0)} / ${distribution.p95Ms?.toFixed(0) ?? "–"} ms`;
}

export function PlaybackPerformancePanel({
  events,
  playback,
}: PlaybackPerformancePanelProps) {
  const summary = summariseFrameTimings(events);
  const diagnosticSummary = {
    ...summary,
    droppedFrameCount: playback?.droppedFrameCount ?? 0,
    targetFramesPerSecond: playback?.targetFramesPerSecond,
  };
  const throughputMbps =
    summary.compressedFetchThroughputBps === undefined
      ? undefined
      : summary.compressedFetchThroughputBps / 1_000_000;

  return (
    <section
      className="performance-summary"
      aria-label="Playback performance summary"
      data-performance-summary={JSON.stringify(diagnosticSummary)}
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
          <dt>Compressed fetch p50 / p95</dt>
          <dd>{formatTiming(summary.compressedFetch)}</dd>
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
          <dt>Observed compressed throughput</dt>
          <dd>
            {throughputMbps === undefined
              ? "waiting"
              : `${throughputMbps.toFixed(1)} Mbps`}
          </dd>
        </div>
        <div>
          <dt>Presentation cadence p50 / p95</dt>
          <dd>{formatTiming(summary.presentationCadence)}</dd>
        </div>
        <div>
          <dt>Presentation rate</dt>
          <dd>
            {summary.switchingFramesPerSecond === undefined
              ? "waiting"
              : `${summary.switchingFramesPerSecond.toFixed(1)} fps`}
          </dd>
        </div>
        <div>
          <dt>Actual Spark display commits</dt>
          <dd>
            {summary.displayCommitFramesPerSecond === undefined
              ? "waiting"
              : `${summary.displayCommitFramesPerSecond.toFixed(1)} fps`}
          </dd>
        </div>
        <div>
          <dt>Dropped frames</dt>
          <dd>{playback?.droppedFrameCount.toLocaleString() ?? "0"}</dd>
        </div>
        <div>
          <dt>Render call p50 / p95</dt>
          <dd>{formatTiming(summary.renderCall)}</dd>
        </div>
        <div>
          <dt>Spark update p50 / p95</dt>
          <dd>{formatTiming(summary.sparkUpdate)}</dd>
        </div>
        <div>
          <dt>Spark sort p50 / p95</dt>
          <dd>{formatTiming(summary.sort)}</dd>
        </div>
        <div>
          <dt>Sort GPU readback p50 / p95</dt>
          <dd>{formatTiming(summary.sortReadback)}</dd>
        </div>
        <div>
          <dt>Sort worker p50 / p95</dt>
          <dd>{formatTiming(summary.sortWorker)}</dd>
        </div>
        <div>
          <dt>Sort order upload p50 / p95</dt>
          <dd>{formatTiming(summary.sortOrderingUpload)}</dd>
        </div>
        <div>
          <dt>Neutral codec decode p50 / p95</dt>
          <dd>{formatTiming(summary.codecDecode)}</dd>
        </div>
        <div>
          <dt>Spark pack total p50 / p95</dt>
          <dd>{formatTiming(summary.flatPack)}</dd>
        </div>
        <div>
          <dt>Pack queue p50 / p95</dt>
          <dd>{formatTiming(summary.flatPackQueue)}</dd>
        </div>
        <div>
          <dt>Pack worker p50 / p95</dt>
          <dd>{formatTiming(summary.flatPackWorker)}</dd>
        </div>
        <div>
          <dt>Pack result transfer p50 / p95</dt>
          <dd>{formatTiming(summary.flatPackTransfer)}</dd>
        </div>
        <div>
          <dt>Pack main bind p50 / p95</dt>
          <dd>{formatTiming(summary.flatPackBind)}</dd>
        </div>
        <div>
          <dt>Legacy Spark SPZ decode p50 / p95</dt>
          <dd>{formatTiming(summary.flatDecode)}</dd>
        </div>
        <div>
          <dt>Flat frame copy p50 / p95</dt>
          <dd>{formatTiming(summary.flatFrameCopy)}</dd>
        </div>
      </dl>
    </section>
  );
}
