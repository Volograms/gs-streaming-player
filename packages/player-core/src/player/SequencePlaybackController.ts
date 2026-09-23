import {
  forwardFrameDelaySeconds,
  sequencePlaybackDurationSeconds,
} from "../manifest/timeline.js";

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
  durationSeconds?: number;
  loop?: boolean;
  minimumReadyFrames?: number;
  sequence: DynamicGaussianSequence;
}

export interface SequencePlaybackSnapshot {
  bufferAheadFrames: number;
  bufferAheadSeconds: number;
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
  private readonly durationSeconds: number;
  private errorValue: unknown;
  private lifecycleValue: PlayerLifecycleState = "READY";
  private readonly listeners = new Set<SnapshotListener>();
  private readonly loop: boolean;
  private readonly minimumReadyFrames: number;
  private operationRevision = 0;
  private presentationController: AbortController | undefined;
  private readonly sequence: DynamicGaussianSequence;
  private timerHandle: unknown;
  private timelineAnchorSeconds = 0;
  private timelinePositionSeconds = 0;
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
    if (this.sequence.frames.length !== this.sequence.frameCount) {
      throw new RangeError("sequence.frames must match sequence.frameCount.");
    }
    let previousTimestamp = -1;
    for (const frame of this.sequence.frames) {
      if (
        !Number.isFinite(frame.timestampSeconds) ||
        frame.timestampSeconds < 0 ||
        frame.timestampSeconds <= previousTimestamp
      ) {
        throw new RangeError(
          "sequence frame timestamps must be finite and increasing.",
        );
      }
      previousTimestamp = frame.timestampSeconds;
    }
    this.durationSeconds =
      options.durationSeconds ?? sequencePlaybackDurationSeconds(this.sequence);
    if (
      !Number.isFinite(this.durationSeconds) ||
      this.durationSeconds <= 0 ||
      this.durationSeconds < previousTimestamp
    ) {
      throw new RangeError(
        "durationSeconds must be positive and include the final frame timestamp.",
      );
    }
    this.timelinePositionSeconds =
      this.sequence.frames[this.currentFrameIndexValue]?.timestampSeconds ?? 0;
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
      bufferAheadSeconds: this.countReadySecondsAhead(),
      currentFrameIndex: this.currentFrameIndexValue,
      currentTimeSeconds: this.currentTimeSeconds(),
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
    if (!this.loop && this.lifecycleValue === "ENDED") {
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
    if (this.lifecycleValue === "PLAYING") {
      this.timelinePositionSeconds = this.activeTimelineSeconds();
    }
    this.desiredPlaying = false;
    this.beginOperation();
    if (this.lifecycleValue !== "ENDED" && this.lifecycleValue !== "ERROR") {
      this.lifecycleValue = "PAUSED";
    }
    this.emit();
  }

  async seek(requestedFrameIndex: number, timeSeconds?: number): Promise<void> {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    const requestedTime =
      timeSeconds ?? this.sequence.frames[frameIndex]?.timestampSeconds ?? 0;
    this.validateSeekTime(frameIndex, requestedTime);
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
      this.timelinePositionSeconds = requestedTime;
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
    this.timelineAnchorSeconds = this.timelinePositionSeconds;
    this.wallAnchorMs = this.clock.now();
    this.lifecycleValue = "PLAYING";
    this.emit();
    this.scheduleNextFrame(revision);
  }

  private scheduleNextFrame(revision: number): void {
    if (!this.isPlayableOperation(revision)) {
      return;
    }
    if (!this.loop && this.currentOrdinal >= this.lastFrameIndex) {
      this.scheduleEnd(revision);
      return;
    }
    const nextOrdinal = this.currentOrdinal + 1;
    const deadlineMs =
      this.wallAnchorMs +
      (this.timelineForOrdinal(nextOrdinal) - this.timelineAnchorSeconds) * 1000;
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
    const dueTimelineSeconds =
      this.timelineAnchorSeconds + (this.clock.now() - this.wallAnchorMs) / 1000 + 1e-7;
    let dueOrdinal = Math.max(
      this.currentOrdinal + 1,
      this.ordinalAtOrBefore(dueTimelineSeconds),
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
    this.timelinePositionSeconds = this.timelineForOrdinal(dueOrdinal);
    this.emit();

    if (!readyAtDeadline) {
      await this.buffer.whenPresentationReadyAhead(this.minimumReadyFrames);
      if (!this.isPlayableOperation(revision)) {
        return;
      }
      this.timelineAnchorSeconds = this.timelinePositionSeconds;
      this.wallAnchorMs = this.clock.now();
      this.lifecycleValue = "PLAYING";
      this.emit();
    }
    this.scheduleNextFrame(revision);
  }

  private scheduleEnd(revision: number): void {
    const deadlineMs =
      this.wallAnchorMs + (this.durationSeconds - this.timelineAnchorSeconds) * 1000;
    this.timerHandle = this.clock.setTimeout(
      () => {
        this.timerHandle = undefined;
        if (!this.isPlayableOperation(revision)) {
          return;
        }
        this.timelinePositionSeconds = this.durationSeconds;
        this.desiredPlaying = false;
        this.lifecycleValue = "ENDED";
        this.emit();
      },
      Math.max(0, deadlineMs - this.clock.now()),
    );
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

  private countReadySecondsAhead(): number {
    let seconds = 0;
    let previousFrameIndex = this.currentFrameIndexValue;
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
      seconds += forwardFrameDelaySeconds(
        this.sequence,
        previousFrameIndex,
        frameIndex,
        this.loop,
        this.durationSeconds,
      );
      previousFrameIndex = frameIndex;
    }
    const currentFrameTime =
      this.sequence.frames[this.currentFrameIndexValue]?.timestampSeconds ?? 0;
    const elapsedInCurrentFrame = Math.max(
      0,
      this.currentTimeSeconds() - currentFrameTime,
    );
    return Math.max(0, seconds - elapsedInCurrentFrame);
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

  private timelineForOrdinal(ordinal: number): number {
    const frameIndex = this.frameIndexForOrdinal(ordinal);
    const timestamp = this.sequence.frames[frameIndex]?.timestampSeconds ?? 0;
    if (!this.loop) {
      return timestamp;
    }
    return (
      Math.floor(ordinal / this.sequence.frameCount) * this.durationSeconds + timestamp
    );
  }

  private ordinalAtOrBefore(timelineSeconds: number): number {
    if (!this.loop) {
      return this.frameIndexAtOrBefore(timelineSeconds);
    }
    let cycle = Math.floor(timelineSeconds / this.durationSeconds);
    const localTimeline = timelineSeconds - cycle * this.durationSeconds;
    let frameIndex = this.frameIndexAtOrBefore(localTimeline);
    if (frameIndex < 0) {
      cycle -= 1;
      frameIndex = this.lastFrameIndex;
    }
    return Math.max(0, cycle * this.sequence.frameCount + frameIndex);
  }

  private frameIndexAtOrBefore(timelineSeconds: number): number {
    let lower = 0;
    let upper = this.lastFrameIndex;
    let selected = -1;
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const timestamp = this.sequence.frames[middle]?.timestampSeconds ?? 0;
      if (timestamp <= timelineSeconds) {
        selected = middle;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    return selected;
  }

  private currentTimeSeconds(): number {
    const timelineSeconds =
      this.lifecycleValue === "PLAYING"
        ? this.activeTimelineSeconds()
        : this.timelinePositionSeconds;
    if (!this.loop) {
      return Math.min(this.durationSeconds, timelineSeconds);
    }
    const loopTime =
      ((timelineSeconds % this.durationSeconds) + this.durationSeconds) %
      this.durationSeconds;
    // Floating-point rounding at a loop boundary must not seek audio to the end
    // of the preceding cycle after the next cycle's first frame is presented.
    return this.durationSeconds - loopTime < 1e-7 ? 0 : loopTime;
  }

  private activeTimelineSeconds(): number {
    return this.timelineAnchorSeconds + (this.clock.now() - this.wallAnchorMs) / 1000;
  }

  private validateSeekTime(frameIndex: number, timeSeconds: number): void {
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > this.durationSeconds
    ) {
      throw new RangeError("Seek time must be within the sequence duration.");
    }
    const frameStart = this.sequence.frames[frameIndex]?.timestampSeconds ?? 0;
    const frameEnd =
      this.sequence.frames[frameIndex + 1]?.timestampSeconds ?? this.durationSeconds;
    if (timeSeconds < frameStart || timeSeconds > frameEnd) {
      throw new RangeError("Seek time must fall within the selected frame's interval.");
    }
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
