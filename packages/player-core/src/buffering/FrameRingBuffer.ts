import type {
  FrameRingBufferConfiguration,
  FrameRingBufferSnapshot,
  BufferedFrame,
  BufferedFrameStatus,
} from "./types.js";
import type {
  DynamicGaussianSequence,
  GaussianFrameSource,
} from "../manifest/types.js";
import type { GaussianRendererAdapter, PreparedFrame } from "../renderer/types.js";

interface FrameRecord {
  controller: AbortController;
  downloadedBytes: number;
  deadlineMs: number;
  preparation: Promise<PreparedFrame>;
  preparedFrame?: PreparedFrame;
  qualityLevel: number;
  refinementEnabled: boolean;
  requestedBytes: number;
  source: GaussianFrameSource;
  status: BufferedFrameStatus;
  targetQualityLevel: number;
}

export interface FrameRingBufferOptions extends FrameRingBufferConfiguration {
  now?: () => number;
  renderer: GaussianRendererAdapter;
  sequence: DynamicGaussianSequence;
}

type SnapshotListener = (snapshot: FrameRingBufferSnapshot) => void;

export class FrameRingBuffer {
  private readonly futureFrameCount: number;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly loop: boolean;
  private readonly now: () => number;
  private readonly previousFrameCount: number;
  private readonly records = new Map<number, FrameRecord>();
  private readonly renderer: GaussianRendererAdapter;
  private readonly sequence: DynamicGaussianSequence;
  private currentFrameIndexValue: number | undefined;
  private disposed = false;
  private windowFrameIndexValue: number | undefined;

  constructor(options: FrameRingBufferOptions) {
    this.renderer = options.renderer;
    this.sequence = options.sequence;
    this.futureFrameCount = options.futureFrameCount ?? 3;
    this.previousFrameCount = options.previousFrameCount ?? 1;
    this.loop = options.loop ?? false;
    this.now = options.now ?? (() => performance.now());
    if (this.futureFrameCount < 0 || !Number.isInteger(this.futureFrameCount)) {
      throw new RangeError("futureFrameCount must be a non-negative integer.");
    }
    if (this.previousFrameCount < 0 || !Number.isInteger(this.previousFrameCount)) {
      throw new RangeError("previousFrameCount must be a non-negative integer.");
    }
  }

  get snapshot(): FrameRingBufferSnapshot {
    return {
      capacity: 1 + this.futureFrameCount + this.previousFrameCount,
      ...(this.currentFrameIndexValue === undefined
        ? {}
        : { currentFrameIndex: this.currentFrameIndexValue }),
      frames: [...this.records.values()]
        .map((record): BufferedFrame => this.snapshotRecord(record))
        .sort((a, b) => a.frameIndex - b.frameIndex),
      futureFrameCount: this.futureFrameCount,
      previousFrameCount: this.previousFrameCount,
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.assertNotDisposed();
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async initialise(frameIndex = 0): Promise<PreparedFrame> {
    return this.present(frameIndex);
  }

  async present(requestedFrameIndex: number): Promise<PreparedFrame> {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    this.reconcileWindow(frameIndex, this.currentFrameIndexValue);
    const preparedFrame = await this.ensureFrame(frameIndex);
    this.assertNotDisposed();

    const previousFrameIndex = this.currentFrameIndexValue;
    if (previousFrameIndex !== undefined && previousFrameIndex !== frameIndex) {
      const previous = this.records.get(previousFrameIndex);
      if (previous !== undefined) {
        previous.status = "base-ready";
      }
    }
    this.renderer.presentFrame(preparedFrame);
    const record = this.requireRecord(frameIndex);
    record.status = "presented";
    record.targetQualityLevel = 1;
    this.currentFrameIndexValue = frameIndex;
    this.reconcileWindow(frameIndex);
    this.emit();
    return preparedFrame;
  }

  async whenBuffered(): Promise<void> {
    this.assertNotDisposed();
    const currentFrameIndex = this.currentFrameIndexValue ?? 0;
    const desired = this.desiredFrameIndices(currentFrameIndex);
    await Promise.all([...desired].map((frameIndex) => this.ensureFrame(frameIndex)));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const record of this.records.values()) {
      record.controller.abort();
      if (record.preparedFrame !== undefined) {
        this.renderer.releaseFrame(record.preparedFrame);
      }
    }
    this.records.clear();
    this.listeners.clear();
  }

  private ensureFrame(frameIndex: number): Promise<PreparedFrame> {
    const existing = this.records.get(frameIndex);
    if (existing !== undefined) {
      return existing.preparation;
    }

    const source = this.sequence.frames[frameIndex];
    if (source === undefined) {
      throw new RangeError(`Frame ${frameIndex} does not exist in the sequence.`);
    }
    const controller = new AbortController();
    const temporalDistance = this.temporalDistance(frameIndex);
    const record = {} as FrameRecord;
    record.controller = controller;
    record.deadlineMs =
      this.now() + (temporalDistance / this.sequence.frameRate) * 1000;
    record.downloadedBytes = 0;
    record.qualityLevel = -1;
    record.refinementEnabled = false;
    record.requestedBytes = source.byteSize ?? 0;
    record.source = source;
    record.status = "loading-base";
    record.targetQualityLevel = 0;
    record.preparation = this.renderer
      .prepareFrame(this.sequence.id, source, {
        signal: controller.signal,
        minimumQualityOnly: true,
        onProgress: ({ loadedBytes, totalBytes }) => {
          record.downloadedBytes = loadedBytes;
          record.requestedBytes = totalBytes ?? record.requestedBytes;
          this.emit();
        },
        ...(this.sequence.transform === undefined
          ? {}
          : { transform: this.sequence.transform }),
      })
      .then((preparedFrame) => {
        record.preparedFrame = preparedFrame;
        record.qualityLevel = preparedFrame.qualityLevel;
        record.status = "base-ready";
        this.applyRefinementPolicies();
        this.emit();
        return preparedFrame;
      })
      .catch((error: unknown) => {
        record.status = controller.signal.aborted ? "expired" : "failed";
        this.emit();
        throw error;
      });
    this.records.set(frameIndex, record);
    this.emit();
    return record.preparation;
  }

  private reconcileWindow(frameIndex: number, preservedFrameIndex?: number): void {
    this.windowFrameIndexValue = frameIndex;
    const desired = this.desiredFrameIndices(frameIndex);
    if (preservedFrameIndex !== undefined) {
      desired.add(preservedFrameIndex);
      this.trimPreservedWindow(desired, frameIndex, preservedFrameIndex);
    }
    for (const desiredFrameIndex of desired) {
      void this.ensureFrame(desiredFrameIndex).catch(() => undefined);
    }
    for (const [bufferedFrameIndex, record] of this.records) {
      if (!desired.has(bufferedFrameIndex)) {
        record.controller.abort();
        if (record.preparedFrame !== undefined) {
          this.renderer.releaseFrame(record.preparedFrame);
        }
        this.records.delete(bufferedFrameIndex);
        continue;
      }
    }
    this.applyRefinementPolicies();
    this.emit();
  }

  private applyRefinementPolicies(): void {
    const windowFrameIndex = this.windowFrameIndexValue;
    if (windowFrameIndex === undefined) {
      return;
    }
    const baseWindowReady = [...this.records.values()].every(
      ({ preparedFrame }) => preparedFrame !== undefined,
    );
    for (const [frameIndex, record] of this.records) {
      this.applyRefinementPolicy(frameIndex, record, windowFrameIndex, baseWindowReady);
    }
  }

  private applyRefinementPolicy(
    frameIndex: number,
    record: FrameRecord,
    windowFrameIndex: number,
    baseWindowReady: boolean,
  ): void {
    const preparedFrame = record.preparedFrame;
    if (preparedFrame === undefined) {
      return;
    }
    const distance = this.forwardDistanceFrom(windowFrameIndex, frameIndex);
    const refine = baseWindowReady && distance > 0 && distance <= this.futureFrameCount;
    if (record.refinementEnabled !== refine) {
      this.renderer.setFrameRefinement(preparedFrame, refine);
      record.refinementEnabled = refine;
    }
    if (frameIndex !== this.currentFrameIndexValue) {
      record.status = refine ? "refining" : "base-ready";
      record.targetQualityLevel = refine ? 1 : 0;
    }
  }

  private trimPreservedWindow(
    desired: Set<number>,
    frameIndex: number,
    preservedFrameIndex: number,
  ): void {
    const capacity = 1 + this.futureFrameCount + this.previousFrameCount;
    for (
      let offset = this.futureFrameCount;
      desired.size > capacity && offset > 0;
      offset -= 1
    ) {
      const candidate = this.offsetFrameIndex(frameIndex, offset);
      if (candidate !== undefined && candidate !== preservedFrameIndex) {
        desired.delete(candidate);
      }
    }
    for (
      let offset = this.previousFrameCount;
      desired.size > capacity && offset > 0;
      offset -= 1
    ) {
      const candidate = this.offsetFrameIndex(frameIndex, -offset);
      if (candidate !== undefined && candidate !== preservedFrameIndex) {
        desired.delete(candidate);
      }
    }
  }

  private desiredFrameIndices(frameIndex: number): Set<number> {
    const desired = new Set<number>([frameIndex]);
    for (let offset = 1; offset <= this.futureFrameCount; offset += 1) {
      const future = this.offsetFrameIndex(frameIndex, offset);
      if (future !== undefined) {
        desired.add(future);
      }
    }
    for (let offset = 1; offset <= this.previousFrameCount; offset += 1) {
      const previous = this.offsetFrameIndex(frameIndex, -offset);
      if (previous !== undefined) {
        desired.add(previous);
      }
    }
    return desired;
  }

  private offsetFrameIndex(frameIndex: number, offset: number): number | undefined {
    const candidate = frameIndex + offset;
    if (this.loop) {
      return (candidate + this.sequence.frameCount) % this.sequence.frameCount;
    }
    return candidate >= 0 && candidate < this.sequence.frameCount
      ? candidate
      : undefined;
  }

  private normaliseFrameIndex(frameIndex: number): number {
    if (!Number.isInteger(frameIndex)) {
      throw new RangeError("frameIndex must be an integer.");
    }
    if (this.loop) {
      return (frameIndex + this.sequence.frameCount) % this.sequence.frameCount;
    }
    if (frameIndex < 0 || frameIndex >= this.sequence.frameCount) {
      throw new RangeError(`Frame ${frameIndex} is outside the sequence.`);
    }
    return frameIndex;
  }

  private temporalDistance(frameIndex: number): number {
    if (this.currentFrameIndexValue === undefined) {
      return frameIndex;
    }
    return this.forwardDistance(frameIndex);
  }

  private forwardDistance(frameIndex: number): number {
    const currentFrameIndex = this.currentFrameIndexValue ?? 0;
    return this.forwardDistanceFrom(currentFrameIndex, frameIndex);
  }

  private forwardDistanceFrom(currentFrameIndex: number, frameIndex: number): number {
    const distance = frameIndex - currentFrameIndex;
    return this.loop && distance < 0 ? distance + this.sequence.frameCount : distance;
  }

  private snapshotRecord(record: FrameRecord): BufferedFrame {
    return {
      deadlineMs: record.deadlineMs,
      downloadedBytes: record.downloadedBytes,
      frameIndex: record.source.frameIndex,
      qualityLevel: record.qualityLevel,
      requestedBytes: record.requestedBytes,
      status: record.status,
      targetQualityLevel: record.targetQualityLevel,
      timestampSeconds: record.source.timestampSeconds,
    };
  }

  private requireRecord(frameIndex: number): FrameRecord {
    const record = this.records.get(frameIndex);
    if (record === undefined) {
      throw new Error(`Frame ${frameIndex} is not buffered.`);
    }
    return record;
  }

  private emit(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Frame ring buffer has been disposed.");
    }
  }
}
