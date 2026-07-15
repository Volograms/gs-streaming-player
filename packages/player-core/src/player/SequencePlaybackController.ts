import type { PlayerLifecycleState } from "./playbackState.js";
import type { FramePresentationOptions } from "../buffering/FrameRingBuffer.js";
import type { FrameRingBufferSnapshot } from "../buffering/types.js";
import type { DynamicGaussianSequence } from "../manifest/types.js";
import type { PreparedFrame } from "../renderer/types.js";

export interface PlaybackClock {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface SequencePlaybackBuffer {
  readonly snapshot: FrameRingBufferSnapshot;
  isPresentationReady(frameIndex: number): boolean;
  prepareForPresentation(frameIndex: number): Promise<PreparedFrame>;
  present(
    frameIndex: number,
    options?: FramePresentationOptions,
  ): Promise<PreparedFrame>;
  whenPresentationReadyAhead(frameCount?: number): Promise<void>;
}

export interface SequencePlaybackControllerOptions {
  buffer: SequencePlaybackBuffer;
  clock?: PlaybackClock;
  loop?: boolean;
  minimumReadyFrames?: number;
  sequence: DynamicGaussianSequence;
}

export interface SequencePlaybackSnapshot {
  bufferAheadFrames: number;
  currentFrameIndex: number;
  currentTimeSeconds: number;
  droppedFrameCount: number;
  error?: unknown;
  isPlaying: boolean;
  lifecycle: PlayerLifecycleState;
  targetFramesPerSecond: number;
}

type SnapshotListener = (snapshot: SequencePlaybackSnapshot) => void;

const defaultClock: PlaybackClock = {
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class SequencePlaybackController {
  private readonly buffer: SequencePlaybackBuffer;
  private readonly clock: PlaybackClock;
  private currentFrameIndexValue: number;
  private currentOrdinal: number;
  private desiredPlaying = false;
  private disposed = false;
  private droppedFrameCountValue = 0;
  private errorValue: unknown;
  private lifecycleValue: PlayerLifecycleState = "READY";
  private readonly listeners = new Set<SnapshotListener>();
  private readonly loop: boolean;
  private readonly minimumReadyFrames: number;
  private operationRevision = 0;
  private ordinalAnchor = 0;
  private presentationController: AbortController | undefined;
  private readonly sequence: DynamicGaussianSequence;
  private timerHandle: unknown;
  private wallAnchorMs = 0;

  constructor(options: SequencePlaybackControllerOptions) {
    this.buffer = options.buffer;
    this.clock = options.clock ?? defaultClock;
    this.sequence = options.sequence;
    this.currentFrameIndexValue = options.buffer.snapshot.currentFrameIndex ?? 0;
    this.currentOrdinal = this.currentFrameIndexValue;
    this.loop = options.loop ?? false;
    this.minimumReadyFrames =
      options.minimumReadyFrames ??
      Math.min(2, options.buffer.snapshot.futureFrameCount);

    if (!Number.isFinite(this.sequence.frameRate) || this.sequence.frameRate <= 0) {
      throw new RangeError("sequence.frameRate must be greater than zero.");
    }
    if (this.sequence.frameCount <= 0) {
      throw new RangeError("sequence.frameCount must be greater than zero.");
    }
    if (
      !Number.isInteger(this.minimumReadyFrames) ||
      this.minimumReadyFrames < 0 ||
      this.minimumReadyFrames > options.buffer.snapshot.futureFrameCount
    ) {
      throw new RangeError(
        "minimumReadyFrames must fit within the buffer's future frame window.",
      );
    }
  }

  get snapshot(): SequencePlaybackSnapshot {
    return {
      bufferAheadFrames: this.countReadyFramesAhead(),
      currentFrameIndex: this.currentFrameIndexValue,
      currentTimeSeconds: this.currentFrameIndexValue / this.sequence.frameRate,
      droppedFrameCount: this.droppedFrameCountValue,
      ...(this.errorValue === undefined ? {} : { error: this.errorValue }),
      isPlaying: this.desiredPlaying,
      lifecycle: this.lifecycleValue,
      targetFramesPerSecond: this.sequence.frameRate,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.assertNotDisposed();
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    this.assertNotDisposed();
    if (this.desiredPlaying) {
      return;
    }
    if (!this.loop && this.currentFrameIndexValue === this.lastFrameIndex) {
      this.lifecycleValue = "ENDED";
      this.emit();
      return;
    }

    this.desiredPlaying = true;
    const revision = this.beginOperation();
    this.lifecycleValue = "BUFFERING";
    this.errorValue = undefined;
    this.emit();
    void this.startAfterBuffering(revision).catch((error: unknown) => {
      this.handleOperationError(revision, error);
    });
  }

  pause(): void {
    this.assertNotDisposed();
    this.desiredPlaying = false;
    this.beginOperation();
    if (this.lifecycleValue !== "ENDED" && this.lifecycleValue !== "ERROR") {
      this.lifecycleValue = "PAUSED";
    }
    this.emit();
  }

  async seek(requestedFrameIndex: number): Promise<void> {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    this.desiredPlaying = false;
    const revision = this.beginOperation();
    const controller = new AbortController();
    this.presentationController = controller;
    this.lifecycleValue = "SEEKING";
    this.errorValue = undefined;
    this.emit();

    try {
      await this.buffer.prepareForPresentation(frameIndex);
      if (!this.isCurrentOperation(revision)) {
        return;
      }
      await this.buffer.present(frameIndex, { signal: controller.signal });
      if (!this.isCurrentOperation(revision)) {
        return;
      }
      this.currentFrameIndexValue = frameIndex;
      this.currentOrdinal = frameIndex;
      this.lifecycleValue = "PAUSED";
      this.emit();
    } catch (error) {
      if (this.isCurrentOperation(revision) && !this.isAbortError(error)) {
        this.handleOperationError(revision, error);
        throw error;
      }
    } finally {
      if (this.presentationController === controller) {
        this.presentationController = undefined;
      }
    }
  }

  async step(delta: number): Promise<void> {
    if (!Number.isInteger(delta)) {
      throw new RangeError("delta must be an integer.");
    }
    await this.seek(this.currentFrameIndexValue + delta);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.desiredPlaying = false;
    this.beginOperation();
    this.disposed = true;
    this.lifecycleValue = "CLOSED";
    this.emit();
    this.listeners.clear();
  }

  private async startAfterBuffering(revision: number): Promise<void> {
    await this.buffer.whenPresentationReadyAhead(this.minimumReadyFrames);
    if (!this.isPlayableOperation(revision)) {
      return;
    }
    this.ordinalAnchor = this.currentOrdinal;
    this.wallAnchorMs = this.clock.now();
    this.lifecycleValue = "PLAYING";
    this.emit();
    this.scheduleNextFrame(revision);
  }

  private scheduleNextFrame(revision: number): void {
    if (!this.isPlayableOperation(revision)) {
      return;
    }
    const nextOrdinal = this.currentOrdinal + 1;
    const deadlineMs =
      this.wallAnchorMs +
      ((nextOrdinal - this.ordinalAnchor) * 1000) / this.sequence.frameRate;
    this.timerHandle = this.clock.setTimeout(
      () => {
        this.timerHandle = undefined;
        void this.advanceAtDeadline(revision).catch((error: unknown) => {
          this.handleOperationError(revision, error);
        });
      },
      Math.max(0, deadlineMs - this.clock.now()),
    );
  }

  private async advanceAtDeadline(revision: number): Promise<void> {
    if (!this.isPlayableOperation(revision)) {
      return;
    }
    const elapsedFrames = Math.max(
      1,
      Math.floor(
        ((this.clock.now() - this.wallAnchorMs) * this.sequence.frameRate) / 1000 +
          1e-7,
      ),
    );
    let dueOrdinal = Math.max(
      this.currentOrdinal + 1,
      this.ordinalAnchor + elapsedFrames,
    );
    if (!this.loop) {
      dueOrdinal = Math.min(dueOrdinal, this.lastFrameIndex);
    }
    const frameIndex = this.frameIndexForOrdinal(dueOrdinal);
    const readyAtDeadline = this.buffer.isPresentationReady(frameIndex);
    if (!readyAtDeadline) {
      this.lifecycleValue = "BUFFERING";
      this.emit();
      await this.buffer.prepareForPresentation(frameIndex);
      if (!this.isPlayableOperation(revision)) {
        return;
      }
    }

    const controller = new AbortController();
    this.presentationController = controller;
    await this.buffer.present(frameIndex, { signal: controller.signal });
    if (this.presentationController === controller) {
      this.presentationController = undefined;
    }
    if (!this.isPlayableOperation(revision)) {
      return;
    }

    this.droppedFrameCountValue += Math.max(0, dueOrdinal - this.currentOrdinal - 1);
    this.currentOrdinal = dueOrdinal;
    this.currentFrameIndexValue = frameIndex;
    this.emit();

    if (!this.loop && frameIndex === this.lastFrameIndex) {
      this.desiredPlaying = false;
      this.lifecycleValue = "ENDED";
      this.emit();
      return;
    }

    if (!readyAtDeadline) {
      await this.buffer.whenPresentationReadyAhead(this.minimumReadyFrames);
      if (!this.isPlayableOperation(revision)) {
        return;
      }
      this.ordinalAnchor = this.currentOrdinal;
      this.wallAnchorMs = this.clock.now();
      this.lifecycleValue = "PLAYING";
      this.emit();
    }
    this.scheduleNextFrame(revision);
  }

  private beginOperation(): number {
    this.operationRevision += 1;
    this.clearTimer();
    this.presentationController?.abort();
    this.presentationController = undefined;
    return this.operationRevision;
  }

  private clearTimer(): void {
    if (this.timerHandle !== undefined) {
      this.clock.clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  private countReadyFramesAhead(): number {
    let count = 0;
    for (let offset = 1; offset <= this.buffer.snapshot.futureFrameCount; offset += 1) {
      const frameIndex = this.offsetFrameIndex(this.currentFrameIndexValue, offset);
      if (frameIndex === undefined) {
        break;
      }
      const frame = this.buffer.snapshot.frames.find(
        (candidate) => candidate.frameIndex === frameIndex,
      );
      if (frame?.status !== "ready" && frame?.status !== "presented") {
        break;
      }
      count += 1;
    }
    return count;
  }

  private get lastFrameIndex(): number {
    return this.sequence.frameCount - 1;
  }

  private frameIndexForOrdinal(ordinal: number): number {
    return this.loop
      ? ((ordinal % this.sequence.frameCount) + this.sequence.frameCount) %
          this.sequence.frameCount
      : ordinal;
  }

  private normaliseFrameIndex(frameIndex: number): number {
    if (!Number.isInteger(frameIndex)) {
      throw new RangeError("frameIndex must be an integer.");
    }
    if (this.loop) {
      return this.frameIndexForOrdinal(frameIndex);
    }
    if (frameIndex < 0 || frameIndex > this.lastFrameIndex) {
      throw new RangeError(`Frame ${frameIndex} is outside the sequence.`);
    }
    return frameIndex;
  }

  private offsetFrameIndex(frameIndex: number, offset: number): number | undefined {
    const candidate = frameIndex + offset;
    if (this.loop) {
      return this.frameIndexForOrdinal(candidate);
    }
    return candidate <= this.lastFrameIndex ? candidate : undefined;
  }

  private isCurrentOperation(revision: number): boolean {
    return !this.disposed && revision === this.operationRevision;
  }

  private isPlayableOperation(revision: number): boolean {
    return this.isCurrentOperation(revision) && this.desiredPlaying;
  }

  private handleOperationError(revision: number, error: unknown): void {
    if (!this.isCurrentOperation(revision) || this.isAbortError(error)) {
      return;
    }
    this.desiredPlaying = false;
    this.clearTimer();
    this.errorValue = error;
    this.lifecycleValue = "ERROR";
    this.emit();
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Sequence playback controller has been disposed.");
    }
  }
}
