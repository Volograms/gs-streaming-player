import type { FrameRingBufferTraceEvent } from "@6g-path/gaussian-player";

const eventLabels: Record<FrameRingBufferTraceEvent["type"], string> = {
  "base-progress": "base transfer",
  "base-ready": "base ready",
  "base-requested": "base requested",
  evicted: "evicted",
  failed: "failed",
  "presentation-ready": "presentation gate passed",
  "presentation-requested": "presentation requested",
  presented: "presented",
  "refinement-cancelled": "refinement cancelled",
  "refinement-progress": "refinement progress",
  "refinement-ready": "refinement ready",
  "refinement-started": "refinement started",
  "renderer-phase": "Spark preparation",
  "window-updated": "buffer window",
};

export interface PlaybackTracePanelProps {
  events: readonly Readonly<FrameRingBufferTraceEvent>[];
  onClear(): void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(2)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} kB`;
  }
  return `${bytes} B`;
}

function describeEvent(event: Readonly<FrameRingBufferTraceEvent>): string {
  const details: string[] = [];
  if (event.phase !== undefined) {
    details.push(event.phase);
  }
  if (event.durationMs !== undefined) {
    details.push(`${event.durationMs.toFixed(1)} ms`);
  }
  if (event.loadedBytes !== undefined) {
    details.push(
      event.totalBytes === undefined
        ? formatBytes(event.loadedBytes)
        : `${formatBytes(event.loadedBytes)} / ${formatBytes(event.totalBytes)}`,
    );
  }
  const quality = event.quality;
  if (quality !== undefined) {
    details.push(quality.state, `detail ${(quality.detailLevel * 100).toFixed(0)}%`);
    if (quality.demandedPageCount !== undefined) {
      details.push(
        `pages ${quality.residentPageCount ?? 0}/${quality.demandedPageCount}`,
      );
    }
    if ((quality.fetchingPageCount ?? 0) > 0) {
      details.push(`fetch ${quality.fetchingPageCount}`);
    }
    if ((quality.uploadPendingPageCount ?? 0) > 0) {
      details.push(`GPU queue ${quality.uploadPendingPageCount}`);
    }
    if (quality.selectedSplatCount !== undefined) {
      details.push(`${quality.selectedSplatCount.toLocaleString()} splats`);
    }
    if (quality.loadedBytes !== undefined) {
      details.push(
        quality.totalBytes === undefined
          ? formatBytes(quality.loadedBytes)
          : `${formatBytes(quality.loadedBytes)} / ${formatBytes(quality.totalBytes)}`,
      );
    }
  }
  if (event.frames !== undefined) {
    details.push(
      event.frames
        .map(({ frameIndex, status }) => `${frameIndex}:${status}`)
        .join("  "),
    );
  }
  if (event.errorMessage !== undefined) {
    details.push(event.errorMessage);
  }
  return details.join(" · ");
}

export function PlaybackTracePanel({ events, onClear }: PlaybackTracePanelProps) {
  const firstTimestamp = events[0]?.atMs ?? 0;
  const visibleEvents = events.slice(-50).reverse();

  return (
    <section className="playback-trace" aria-label="Playback trace">
      <header>
        <div>
          <span>Playback trace</span>
          <strong>{events.length === 0 ? "waiting for dynamic RAD" : "live"}</strong>
        </div>
        <button disabled={events.length === 0} onClick={onClear} type="button">
          Clear
        </button>
      </header>
      <p>
        Timings use a monotonic clock. Open the browser console for the same events as
        structured objects.
      </p>
      <ol aria-live="polite">
        {visibleEvents.map((event, reverseIndex) => (
          <li
            data-frame-index={event.frameIndex}
            data-trace-type={event.type}
            key={`${event.atMs}:${event.type}:${event.frameIndex ?? "window"}:${reverseIndex}`}
          >
            <time>+{(event.atMs - firstTimestamp).toFixed(1)} ms</time>
            <strong>
              {event.frameIndex === undefined ? "Buffer" : `F${event.frameIndex}`} ·{" "}
              {eventLabels[event.type]}
            </strong>
            <span>{describeEvent(event)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
