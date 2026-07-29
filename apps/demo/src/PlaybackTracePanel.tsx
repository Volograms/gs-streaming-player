import type { FrameRingBufferTraceEvent } from "@6g-path/gaussian-player";

const eventLabels: Record<FrameRingBufferTraceEvent["type"], string> = {
  "base-progress": "base transfer",
  "base-ready": "base ready",
  "base-requested": "base requested",
  "base-started": "base started",
  "compressed-cache-hit": "compressed cache hit",
  "compressed-fetch-failed": "compressed fetch failed",
  "compressed-fetch-ready": "compressed fetch ready",
  "compressed-fetch-started": "compressed fetch started",
  "codec-decode-ready": "codec decode ready",
  "codec-decode-started": "codec decode started",
  "codec-phase": "codec phase",
  evicted: "evicted",
  failed: "failed",
  "presentation-ready": "presentation gate passed",
  "presentation-requested": "presentation requested",
  presented: "presented",
  "refinement-cancelled": "refinement cancelled",
  "refinement-progress": "refinement progress",
  "refinement-ready": "refinement ready",
  "refinement-started": "refinement started",
  "render-timing": "render timing",
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
  if (event.codecId !== undefined) {
    details.push(event.codecId);
  }
  if (event.codecPhase !== undefined) {
    details.push(event.codecPhase);
  }
  if (event.durationMs !== undefined) {
    details.push(
      event.type === "renderer-phase"
        ? `at ${event.durationMs.toFixed(1)} ms`
        : `${event.durationMs.toFixed(1)} ms`,
    );
  }
  if (event.stageDurationMs !== undefined) {
    details.push(`stage ${event.stageDurationMs.toFixed(1)} ms`);
  }
  if (event.chunkIndex !== undefined) {
    details.push(`chunk ${event.chunkIndex}`);
  }
  if (event.pageIndex !== undefined) {
    details.push(`page ${event.pageIndex}`);
  }
  if (event.reusedPage !== undefined) {
    details.push(event.reusedPage ? "reused evicted page" : "preallocated free page");
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
    const achievedDetail = quality.achievedDetailLevel ?? quality.detailLevel;
    const requestedDetail = quality.requestedDetailLevel ?? quality.detailLevel;
    details.push(
      quality.state,
      `achieved ${(achievedDetail * 100).toFixed(0)}%`,
      `requested ${(requestedDetail * 100).toFixed(0)}%`,
    );
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
  const visibleEvents = events
    .filter(({ type }) => type !== "render-timing")
    .slice(-50)
    .reverse();

  return (
    <section className="playback-trace" aria-label="Playback trace">
      <header>
        <div>
          <span>Playback trace</span>
          <strong>{events.length === 0 ? "waiting for dynamic GS" : "live"}</strong>
        </div>
        <button disabled={events.length === 0} onClick={onClear} type="button">
          Clear
        </button>
      </header>
      <p>
        Timings use a monotonic clock. Events are collected continuously and displayed
        in bounded batches to avoid disturbing playback.
      </p>
      <ol aria-live="polite">
        {visibleEvents.map((event, visibleIndex) => (
          <li
            data-frame-index={event.frameIndex}
            data-trace-type={event.type}
            key={`${event.atMs}:${event.type}:${event.frameIndex ?? "window"}:${event.phase ?? "event"}:${event.loadedBytes ?? "none"}:${visibleIndex}`}
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
