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
import type {
  FramePresentationQuality,
  FrameQualityTarget,
  GaussianRendererAdapter,
  PreparedFrame,
} from "../renderer/types.js";
import type { Transform } from "@6g-path/shared";

interface FrameRecord {
  controller: AbortController;
  downloadedBytes: number;
  deadlineMs: number;
  preparation: Promise<PreparedFrame>;
  preparedFrame?: PreparedFrame;
  qualityLevel: number;
  refinement: Promise<void> | undefined;
  refinementController: AbortController | undefined;
  refinementEnabled: boolean;
  requestedBytes: number;
  source: GaussianFrameSource;
  status: BufferedFrameStatus;
  targetQualityLevel: number;
}

export interface FrameRingBufferOptions extends FrameRingBufferConfiguration {
  now?: () => number;
  presentationQualityTarget?: FrameQualityTarget;
  renderer: GaussianRendererAdapter;
  sequence: DynamicGaussianSequence;
}

export interface FramePresentationOptions {
  signal?: AbortSignal;
}

type SnapshotListener = (snapshot: FrameRingBufferSnapshot) => void;

export class FrameRingBuffer {
  private readonly futureFrameCount: number;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly loop: boolean;
  private readonly now: () => number;
  private readonly previousFrameCount: number;
  private readonly presentationQualityTarget: FrameQualityTarget;
  private readonly records = new Map<number, FrameRecord>();
  private readonly renderer: GaussianRendererAdapter;
  private readonly sequence: DynamicGaussianSequence;
  private currentFrameIndexValue: number | undefined;
  private disposed = false;
  private presentationRequestRevision = 0;
  private transformRevision = 0;
  private transformValue: Transform | undefined;
  private windowFrameIndexValue: number | undefined;

  constructor(options: FrameRingBufferOptions) {
    this.renderer = options.renderer;
    this.sequence = options.sequence;
    this.transformValue = options.sequence.transform;
    this.futureFrameCount = options.futureFrameCount ?? 3;
    this.previousFrameCount = options.previousFrameCount ?? 1;
    this.loop = options.loop ?? false;
    this.now = options.now ?? (() => performance.now());
    this.presentationQualityTarget = options.presentationQualityTarget ?? {
      detailLevel: 0.25,
      minimumSplatCount: 0,
    };
    if (this.futureFrameCount < 0 || !Number.isInteger(this.futureFrameCount)) {
      throw new RangeError("futureFrameCount must be a non-negative integer.");
    }
    if (this.previousFrameCount < 0 || !Number.isInteger(this.previousFrameCount)) {
      throw new RangeError("previousFrameCount must be a non-negative integer.");
    }
    if (
      !Number.isFinite(this.presentationQualityTarget.detailLevel) ||
      this.presentationQualityTarget.detailLevel <= 0 ||
      this.presentationQualityTarget.detailLevel > 1
    ) {
      throw new RangeError(
        "presentationQualityTarget.detailLevel must be greater than 0 and at most 1.",
      );
    }
    if (
      !Number.isInteger(this.presentationQualityTarget.minimumSplatCount) ||
      this.presentationQualityTarget.minimumSplatCount < 0
    ) {
      throw new RangeError(
        "presentationQualityTarget.minimumSplatCount must be a non-negative integer.",
      );
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

  async present(
    requestedFrameIndex: number,
    options: FramePresentationOptions = {},
  ): Promise<PreparedFrame> {
    const requestRevision = this.presentationRequestRevision + 1;
    this.presentationRequestRevision = requestRevision;
    if (this.isAborted(options.signal)) {
      throw this.presentationAbortError();
    }
    let preparedFrame: PreparedFrame;
    try {
      preparedFrame = await this.prepareForPresentation(requestedFrameIndex);
    } catch (error) {
      if (
        this.isAborted(options.signal) ||
        requestRevision !== this.presentationRequestRevision
      ) {
        throw this.presentationAbortError();
      }
      throw error;
    }
    const frameIndex = preparedFrame.frameIndex;
    this.assertNotDisposed();
    if (
      this.isAborted(options.signal) ||
      requestRevision !== this.presentationRequestRevision
    ) {
      throw this.presentationAbortError();
    }
    try {
      await this.ensurePresentationQuality(frameIndex);
    } catch (error) {
      if (
        this.isAborted(options.signal) ||
        requestRevision !== this.presentationRequestRevision
      ) {
        throw this.presentationAbortError();
      }
      throw error;
    }
    if (
      this.isAborted(options.signal) ||
      requestRevision !== this.presentationRequestRevision
    ) {
      throw this.presentationAbortError();
    }

    const previousFrameIndex = this.currentFrameIndexValue;
    if (previousFrameIndex !== undefined && previousFrameIndex !== frameIndex) {
      const previous = this.records.get(previousFrameIndex);
      if (previous !== undefined) {
        previous.status = "ready";
      }
    }
    this.renderer.presentFrame(preparedFrame);
    const record = this.requireRecord(frameIndex);
    record.status = "presented";
    record.targetQualityLevel = this.presentationQualityTarget.detailLevel;
    this.currentFrameIndexValue = frameIndex;
    this.reconcileWindow(frameIndex);
    this.emit();
    return preparedFrame;
  }

  async prepareForPresentation(requestedFrameIndex: number): Promise<PreparedFrame> {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    this.reconcileWindow(frameIndex, this.currentFrameIndexValue);
    const preparedFrame = await this.ensureFrame(frameIndex);
    await this.ensurePresentationQuality(frameIndex);
    this.assertNotDisposed();
    return preparedFrame;
  }

  isPresentationReady(requestedFrameIndex: number): boolean {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    const record = this.records.get(frameIndex);
    if (record?.preparedFrame === undefined) {
      return false;
    }
    const quality = this.renderer.getFramePresentationQuality(record.preparedFrame);
    this.applyQualitySnapshot(record, quality);
    if (this.meetsPresentationTarget(quality)) {
      return true;
    }
    if (record.refinement === undefined) {
      record.status = "refining";
      this.startRefinement(frameIndex, record);
      this.emit();
    }
    return false;
  }

  async whenPresentationReadyAhead(frameCount = this.futureFrameCount): Promise<void> {
    this.assertNotDisposed();
    if (!Number.isInteger(frameCount) || frameCount < 0) {
      throw new RangeError("frameCount must be a non-negative integer.");
    }
    if (frameCount > this.futureFrameCount) {
      throw new RangeError(
        `frameCount cannot exceed the ${this.futureFrameCount}-frame future window.`,
      );
    }
    const anchorFrameIndex =
      this.currentFrameIndexValue ?? this.windowFrameIndexValue ?? 0;
    for (let offset = 1; offset <= frameCount; offset += 1) {
      const frameIndex = this.offsetFrameIndex(anchorFrameIndex, offset);
      if (frameIndex === undefined) {
        return;
      }
      await this.ensureFrame(frameIndex);
      await this.ensurePresentationQuality(frameIndex);
    }
  }

  async whenBuffered(): Promise<void> {
    this.assertNotDisposed();
    const currentFrameIndex = this.currentFrameIndexValue ?? 0;
    const desired = this.desiredFrameIndices(currentFrameIndex);
    await Promise.all([...desired].map((frameIndex) => this.ensureFrame(frameIndex)));
  }

  /**
   * Replace the local-to-world transform for every buffered frame and for frames
   * prepared later. Prepared frames remain resident, but must revalidate their
   * view-dependent presentation quality after the transform changes.
   */
  setTransform(transform?: Transform): void {
    this.assertNotDisposed();
    this.transformValue = transform;
    this.transformRevision += 1;

    for (const record of this.records.values()) {
      const preparedFrame = record.preparedFrame;
      if (preparedFrame === undefined) {
        continue;
      }
      record.refinementController?.abort();
      record.refinementController = undefined;
      record.refinement = undefined;
      record.refinementEnabled = false;
      this.renderer.setFrameRefinement(preparedFrame, false);
      this.renderer.setFrameTransform(preparedFrame, transform);
      record.qualityLevel = preparedFrame.qualityLevel;
      record.status = "base-ready";
      record.targetQualityLevel = 0;
    }

    this.applyRefinementPolicies();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.presentationRequestRevision += 1;
    for (const record of this.records.values()) {
      record.controller.abort();
      record.refinementController?.abort();
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
    const requestedTransform = this.transformValue;
    const requestedTransformRevision = this.transformRevision;
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
        ...(requestedTransform === undefined ? {} : { transform: requestedTransform }),
      })
      .then((preparedFrame) => {
        if (requestedTransformRevision !== this.transformRevision) {
          this.renderer.setFrameTransform(preparedFrame, this.transformValue);
        }
        record.preparedFrame = preparedFrame;
        record.qualityLevel = preparedFrame.qualityLevel;
        record.status = "base-ready";
        this.applyQualitySnapshot(
          record,
          this.renderer.getFramePresentationQuality(preparedFrame),
        );
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
        record.refinementController?.abort();
        if (record.preparedFrame !== undefined) {
          this.renderer.releaseFrame(record.preparedFrame);
        }
        this.records.delete(bufferedFrameIndex);
        continue;
      }
      const forwardDistance = this.forwardDistanceFrom(frameIndex, bufferedFrameIndex);
      const deadlineDistance =
        forwardDistance >= 0 && forwardDistance <= this.futureFrameCount
          ? forwardDistance
          : 0;
      record.deadlineMs =
        this.now() + (deadlineDistance / this.sequence.frameRate) * 1000;
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
    const isTarget = distance === 0;
    const isFuture = distance > 0 && distance <= this.futureFrameCount;
    const nearerFramesReady = this.areNearerFutureFramesReady(
      windowFrameIndex,
      distance,
    );
    const refine =
      isTarget ||
      (isFuture &&
        (record.status === "ready" || (baseWindowReady && nearerFramesReady)));
    if (refine) {
      this.startRefinement(frameIndex, record);
    } else if (record.refinementEnabled) {
      record.refinementController?.abort();
      record.refinementController = undefined;
      record.refinement = undefined;
      this.renderer.setFrameRefinement(preparedFrame, false);
      record.refinementEnabled = false;
    }
    if (frameIndex !== this.currentFrameIndexValue) {
      if (!refine) {
        record.status = "base-ready";
        record.qualityLevel = preparedFrame.qualityLevel;
      } else if (record.status !== "ready") {
        record.status = "refining";
      }
      record.targetQualityLevel = refine
        ? this.presentationQualityTarget.detailLevel
        : 0;
    }
  }

  private areNearerFutureFramesReady(
    windowFrameIndex: number,
    distance: number,
  ): boolean {
    for (let offset = 1; offset < distance; offset += 1) {
      const frameIndex = this.offsetFrameIndex(windowFrameIndex, offset);
      if (frameIndex === undefined) {
        continue;
      }
      const status = this.records.get(frameIndex)?.status;
      if (status !== "ready" && status !== "presented") {
        return false;
      }
    }
    return true;
  }

  private startRefinement(frameIndex: number, record: FrameRecord): void {
    const preparedFrame = record.preparedFrame;
    if (
      preparedFrame === undefined ||
      record.refinement !== undefined ||
      record.status === "ready" ||
      record.status === "presented"
    ) {
      return;
    }

    const controller = new AbortController();
    record.refinementController = controller;
    record.refinementEnabled = true;
    record.status = "refining";
    record.targetQualityLevel = this.presentationQualityTarget.detailLevel;
    const refinement = this.renderer
      .refineFrame(preparedFrame, this.presentationQualityTarget, {
        signal: controller.signal,
        onProgress: (quality) => {
          if (record.refinementController === controller) {
            this.applyQualitySnapshot(record, quality);
            this.emit();
          }
        },
      })
      .then((quality) => {
        if (record.refinementController !== controller) {
          return;
        }
        this.applyQualitySnapshot(record, quality);
        if (!this.meetsPresentationTarget(quality)) {
          throw new Error(
            `Frame ${frameIndex} refinement completed below presentation quality.`,
          );
        }
        if (frameIndex === this.currentFrameIndexValue) {
          record.status = "presented";
        } else {
          record.status = "ready";
        }
        this.applyRefinementPolicies();
        this.emit();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && record.refinementController === controller) {
          record.status = "failed";
          this.emit();
          throw error;
        }
      })
      .finally(() => {
        if (record.refinementController === controller) {
          record.refinementController = undefined;
          record.refinement = undefined;
        }
      });
    record.refinement = refinement;
    void refinement.catch(() => undefined);
  }

  private async ensurePresentationQuality(frameIndex: number): Promise<void> {
    while (true) {
      const transformRevision = this.transformRevision;
      const record = this.requireRecord(frameIndex);
      const preparedFrame = record.preparedFrame;
      if (preparedFrame === undefined) {
        throw new Error(`Frame ${frameIndex} has not completed base preparation.`);
      }
      const currentQuality = this.renderer.getFramePresentationQuality(preparedFrame);
      this.applyQualitySnapshot(record, currentQuality);
      if (this.meetsPresentationTarget(currentQuality)) {
        if (frameIndex !== this.currentFrameIndexValue) {
          record.status = "ready";
        }
        return;
      }

      record.status = "refining";
      if (record.refinement === undefined) {
        this.startRefinement(frameIndex, record);
      }
      await record.refinement;
      if (transformRevision !== this.transformRevision) {
        continue;
      }
      const settledQuality = this.renderer.getFramePresentationQuality(preparedFrame);
      this.applyQualitySnapshot(record, settledQuality);
      if (!this.meetsPresentationTarget(settledQuality)) {
        throw new Error(`Frame ${frameIndex} did not reach presentation quality.`);
      }
      return;
    }
  }

  private meetsPresentationTarget(
    quality: Readonly<FramePresentationQuality>,
  ): boolean {
    return (
      quality.state === "presentable" &&
      quality.detailLevel >= this.presentationQualityTarget.detailLevel &&
      (quality.selectedSplatCount ?? 0) >=
        this.presentationQualityTarget.minimumSplatCount
    );
  }

  private applyQualitySnapshot(
    record: FrameRecord,
    quality: Readonly<FramePresentationQuality>,
  ): void {
    record.downloadedBytes = quality.loadedBytes ?? record.downloadedBytes;
    record.requestedBytes = quality.totalBytes ?? record.requestedBytes;
    if (quality.state === "presentable") {
      record.qualityLevel = quality.detailLevel;
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

  private presentationAbortError(): Error {
    const error = new Error("Frame presentation was superseded or aborted.");
    error.name = "AbortError";
    return error;
  }

  private isAborted(signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true;
  }
}
