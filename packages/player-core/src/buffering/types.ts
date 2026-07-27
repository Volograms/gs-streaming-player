import type {
  FramePresentationQuality,
  RendererFramePreparationPhase,
} from "../renderer/types.js";

export type BufferedFrameStatus =
  | "empty"
  | "loading-base"
  | "base-ready"
  | "refining"
  | "ready"
  | "presented"
  | "expired"
  | "failed";

export interface BufferedFrame {
  deadlineMs: number;
  downloadedBytes: number;
  frameIndex: number;
  qualityLevel: number;
  requestedBytes: number;
  status: BufferedFrameStatus;
  targetQualityLevel: number;
  timestampSeconds: number;
}

export interface FrameRingBufferSnapshot {
  activeBasePreparationCount: number;
  capacity: number;
  currentFrameIndex?: number;
  frames: readonly BufferedFrame[];
  futureFrameCount: number;
  previousFrameCount: number;
  queuedBasePreparationCount: number;
  compressedBuffer?: Readonly<{
    activeFetchCount: number;
    capacityBytes: number;
    contiguousReadyFrameCount: number;
    queuedFetchCount: number;
    readyFrameCount: number;
    residentBytes: number;
  }>;
}

export interface FrameRingBufferConfiguration {
  compressedBufferMaximumBytes?: number;
  maximumCompressedFetchConcurrency?: number;
  futureFrameCount?: number;
  loop?: boolean;
  maximumBasePreparationConcurrency?: number;
  maximumRefinementConcurrency?: number;
  previousFrameCount?: number;
}

export type FrameRingBufferTraceEventType =
  | "window-updated"
  | "base-requested"
  | "base-started"
  | "base-progress"
  | "compressed-fetch-started"
  | "compressed-fetch-ready"
  | "compressed-cache-hit"
  | "compressed-fetch-failed"
  | "codec-decode-started"
  | "codec-phase"
  | "codec-decode-ready"
  | "renderer-phase"
  | "base-ready"
  | "refinement-started"
  | "refinement-progress"
  | "refinement-ready"
  | "refinement-cancelled"
  | "presentation-requested"
  | "presentation-ready"
  | "presented"
  | "render-timing"
  | "evicted"
  | "failed";

export interface FrameRingBufferTraceFrame {
  frameIndex: number;
  status: BufferedFrameStatus;
}

/** Optional, low-volume diagnostics for explaining buffering and presentation latency. */
export interface FrameRingBufferTraceEvent {
  /** Monotonic timestamp supplied by FrameRingBufferOptions.now. */
  atMs: number;
  /** Time spent reading the response body into the owned ArrayBuffer. */
  bodyReadMs?: number;
  /** Whether Resource Timing reported no new connection setup for this request. */
  connectionReused?: boolean;
  /** DNS-independent TCP/TLS connection setup time reported by Resource Timing. */
  connectionSetupMs?: number;
  /** Duration of the operation represented by this event, when applicable. */
  durationMs?: number;
  displayCommitIntervalsMs?: readonly number[];
  errorMessage?: string;
  frameIndex?: number;
  frames?: readonly FrameRingBufferTraceFrame[];
  loadedBytes?: number;
  /** Browser-reported next-hop protocol, for example http/1.1, h2, or h3. */
  networkProtocol?: string;
  chunkIndex?: number;
  codecId?: string;
  codecPhase?: string;
  pageIndex?: number;
  phase?: RendererFramePreparationPhase;
  quality?: Readonly<FramePresentationQuality>;
  /** Time from fetch start until response headers became available. */
  responseLatencyMs?: number;
  reusedPage?: boolean;
  renderCallSamplesMs?: readonly number[];
  renderIntervalSamplesMs?: readonly number[];
  flatFrameCopySamplesMs?: readonly number[];
  sortOrderingUploadSamplesMs?: readonly number[];
  sortCpuKeySamplesMs?: readonly number[];
  sortReadbackSamplesMs?: readonly number[];
  sortSamplesMs?: readonly number[];
  sortWorkerSamplesMs?: readonly number[];
  sparkUpdateSamplesMs?: readonly number[];
  stageDurationMs?: number;
  totalBytes?: number;
  type: FrameRingBufferTraceEventType;
}

export type FrameRingBufferTraceListener = (
  event: Readonly<FrameRingBufferTraceEvent>,
) => void;
