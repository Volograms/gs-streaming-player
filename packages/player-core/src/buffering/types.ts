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
  capacity: number;
  currentFrameIndex?: number;
  frames: readonly BufferedFrame[];
  futureFrameCount: number;
  previousFrameCount: number;
}

export interface FrameRingBufferConfiguration {
  futureFrameCount?: number;
  loop?: boolean;
  previousFrameCount?: number;
}

export type FrameRingBufferTraceEventType =
  | "window-updated"
  | "base-requested"
  | "base-progress"
  | "renderer-phase"
  | "base-ready"
  | "refinement-started"
  | "refinement-progress"
  | "refinement-ready"
  | "refinement-cancelled"
  | "presentation-requested"
  | "presentation-ready"
  | "presented"
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
  /** Duration of the operation represented by this event, when applicable. */
  durationMs?: number;
  errorMessage?: string;
  frameIndex?: number;
  frames?: readonly FrameRingBufferTraceFrame[];
  loadedBytes?: number;
  phase?: RendererFramePreparationPhase;
  quality?: Readonly<FramePresentationQuality>;
  totalBytes?: number;
  type: FrameRingBufferTraceEventType;
}

export type FrameRingBufferTraceListener = (
  event: Readonly<FrameRingBufferTraceEvent>,
) => void;
