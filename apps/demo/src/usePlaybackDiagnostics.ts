import { useCallback, useEffect, useRef, useState } from "react";

import { PlaybackTraceBuffer } from "./PlaybackTraceBuffer.js";

import type {
  FrameRingBufferTraceEvent,
  SequencePlaybackSnapshot,
} from "@6g-path/gaussian-player";

const TRACE_CAPACITY = 2_000;
const TRACE_REFRESH_INTERVAL_MS = 250;
const PERFORMANCE_REFRESH_INTERVAL_MS = 1_000;

export interface PlaybackDiagnostics {
  clearTrace(): void;
  onPlaybackSnapshot(snapshot: SequencePlaybackSnapshot): void;
  onTrace(event: Readonly<FrameRingBufferTraceEvent>): void;
  performanceEvents: readonly Readonly<FrameRingBufferTraceEvent>[];
  playbackSnapshot?: SequencePlaybackSnapshot;
  visibleEvents: readonly Readonly<FrameRingBufferTraceEvent>[];
}

/**
 * Collects high-frequency player diagnostics without scheduling React work per event.
 * The visible trace and statistical history intentionally refresh at different rates.
 */
export function usePlaybackDiagnostics(): PlaybackDiagnostics {
  const [traceBuffer] = useState(() => new PlaybackTraceBuffer(TRACE_CAPACITY));

  const latestPlaybackSnapshotRef = useRef<SequencePlaybackSnapshot | undefined>(
    undefined,
  );
  const playbackSnapshotVersionRef = useRef(0);
  const renderedPlaybackSnapshotVersionRef = useRef(0);
  const visibleTraceVersionRef = useRef(0);
  const performanceTraceVersionRef = useRef(0);

  const [visibleEvents, setVisibleEvents] = useState<
    readonly Readonly<FrameRingBufferTraceEvent>[]
  >([]);
  const [performanceEvents, setPerformanceEvents] = useState<
    readonly Readonly<FrameRingBufferTraceEvent>[]
  >([]);
  const [playbackSnapshot, setPlaybackSnapshot] = useState<SequencePlaybackSnapshot>();

  useEffect(() => {
    const visibleTimer = setInterval(() => {
      if (visibleTraceVersionRef.current !== traceBuffer.version) {
        visibleTraceVersionRef.current = traceBuffer.version;
        setVisibleEvents(traceBuffer.snapshot());
      }
      if (
        renderedPlaybackSnapshotVersionRef.current !==
        playbackSnapshotVersionRef.current
      ) {
        renderedPlaybackSnapshotVersionRef.current = playbackSnapshotVersionRef.current;
        setPlaybackSnapshot(latestPlaybackSnapshotRef.current);
      }
    }, TRACE_REFRESH_INTERVAL_MS);
    const performanceTimer = setInterval(() => {
      if (performanceTraceVersionRef.current !== traceBuffer.version) {
        performanceTraceVersionRef.current = traceBuffer.version;
        setPerformanceEvents(traceBuffer.snapshot());
      }
    }, PERFORMANCE_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(visibleTimer);
      clearInterval(performanceTimer);
    };
  }, [traceBuffer]);

  const onTrace = useCallback(
    (event: Readonly<FrameRingBufferTraceEvent>) => {
      traceBuffer.append(event);
    },
    [traceBuffer],
  );
  const onPlaybackSnapshot = useCallback((snapshot: SequencePlaybackSnapshot) => {
    latestPlaybackSnapshotRef.current = snapshot;
    playbackSnapshotVersionRef.current += 1;
  }, []);
  const clearTrace = useCallback(() => {
    traceBuffer.clear();
    visibleTraceVersionRef.current = traceBuffer.version;
    performanceTraceVersionRef.current = traceBuffer.version;
    setVisibleEvents([]);
    setPerformanceEvents([]);
  }, [traceBuffer]);

  return {
    clearTrace,
    onPlaybackSnapshot,
    onTrace,
    performanceEvents,
    ...(playbackSnapshot === undefined ? {} : { playbackSnapshot }),
    visibleEvents,
  };
}
