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
