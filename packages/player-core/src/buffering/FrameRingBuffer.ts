import { selectFrameTransferQuality } from "../quality/selectFrameTransferQuality.js";

import { CompressedFrameCache } from "./CompressedFrameCache.js";
import { FramePreparationScheduler } from "./FramePreparationScheduler.js";

import type {
  CompressedFrameCacheTraceEvent,
  CompressedFrameRequest,
} from "./CompressedFrameCache.js";
import type {
  FrameRingBufferConfiguration,
  FrameRingBufferSnapshot,
  BufferedFrame,
  BufferedFrameStatus,
  FrameRingBufferTraceEvent,
  FrameRingBufferTraceListener,
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
import type {
  DecodedGaussianFrame,
  GaussianFrameDecoderRegistry,
} from "@6g-path/gaussian-codec";
import type { Transform } from "@6g-path/shared";

interface FrameRecord {
  controller: AbortController;
  downloadedBytes: number;
  deadlineMs: number;
  preparation: Promise<PreparedFrame>;
  preparedFrame?: PreparedFrame;
  qualityLevel: number;
  preparedSource: GaussianFrameSource;
  refinement: Promise<void> | undefined;
  refinementController: AbortController | undefined;
  refinementEnabled: boolean;
  traceProgressKey: string;
  requestedBytes: number;
  source: GaussianFrameSource;
  status: BufferedFrameStatus;
  targetQualityLevel: number;
}

export interface FrameRingBufferOptions extends FrameRingBufferConfiguration {
  compressedFrameFetch?: typeof fetch;
  /** Optional renderer-neutral codecs keyed by the frame source's codec identifier. */
  decoderRegistry?: GaussianFrameDecoderRegistry;
  now?: () => number;
  onTrace?: FrameRingBufferTraceListener;
  presentationQualityTarget?: FrameQualityTarget;
  renderer: GaussianRendererAdapter;
  sequence: DynamicGaussianSequence;
}

export interface FramePresentationOptions {
  signal?: AbortSignal;
}

type SnapshotListener = (snapshot: FrameRingBufferSnapshot) => void;

export class FrameRingBuffer {
  private readonly basePreparationScheduler: FramePreparationScheduler;
  private readonly compressedFrameCache: CompressedFrameCache | undefined;
  private readonly decoderRegistry: GaussianFrameDecoderRegistry | undefined;
  private readonly futureFrameCount: number;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly loop: boolean;
  private maximumRefinementConcurrency: number;
  private readonly now: () => number;
  private readonly onTrace: FrameRingBufferTraceListener | undefined;
  private readonly previousFrameCount: number;
  private presentationQualityTarget: FrameQualityTarget;
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
    this.decoderRegistry = options.decoderRegistry;
    this.sequence = options.sequence;
    this.transformValue = options.sequence.transform;
    this.futureFrameCount = options.futureFrameCount ?? 3;
    this.previousFrameCount = options.previousFrameCount ?? 1;
    this.loop = options.loop ?? false;
    this.basePreparationScheduler = new FramePreparationScheduler(
      options.maximumBasePreparationConcurrency ?? 4,
    );
    this.maximumRefinementConcurrency = options.maximumRefinementConcurrency ?? 1;
    this.now = options.now ?? (() => performance.now());
    this.onTrace = options.onTrace;
    this.compressedFrameCache =
      options.compressedBufferMaximumBytes === undefined
        ? undefined
        : new CompressedFrameCache({
            ...(options.compressedFrameFetch === undefined
              ? {}
              : { fetch: options.compressedFrameFetch }),
            maximumBytes: options.compressedBufferMaximumBytes,
            maximumFetchConcurrency: options.maximumCompressedFetchConcurrency ?? 6,
            now: this.now,
            onChange: () => this.emit(),
            onTrace: (event) => this.traceCompressedFetch(event),
          });
    this.presentationQualityTarget = options.presentationQualityTarget ?? {
      detailLevel: 0.25,
      minimumSplatCount: 2,
    };
    if (this.futureFrameCount < 0 || !Number.isInteger(this.futureFrameCount)) {
      throw new RangeError("futureFrameCount must be a non-negative integer.");
    }
    if (this.previousFrameCount < 0 || !Number.isInteger(this.previousFrameCount)) {
      throw new RangeError("previousFrameCount must be a non-negative integer.");
    }
    if (
      !Number.isInteger(this.maximumRefinementConcurrency) ||
      this.maximumRefinementConcurrency <= 0
    ) {
      throw new RangeError("maximumRefinementConcurrency must be a positive integer.");
    }
    this.validatePresentationQualityTarget(this.presentationQualityTarget);
  }

  get snapshot(): FrameRingBufferSnapshot {
    return {
      activeBasePreparationCount: this.basePreparationScheduler.activeCount,
      capacity: 1 + this.futureFrameCount + this.previousFrameCount,
      ...(this.currentFrameIndexValue === undefined
        ? {}
        : { currentFrameIndex: this.currentFrameIndexValue }),
      frames: [...this.records.values()]
        .map((record): BufferedFrame => this.snapshotRecord(record))
        .sort((a, b) => a.frameIndex - b.frameIndex),
      futureFrameCount: this.futureFrameCount,
      previousFrameCount: this.previousFrameCount,
      queuedBasePreparationCount: this.basePreparationScheduler.queuedCount,
      ...(this.compressedFrameCache === undefined
        ? {}
        : { compressedBuffer: this.compressedFrameCache.snapshot }),
    };
  }

  setPreparationConcurrency(
    maximumBasePreparationConcurrency: number,
    maximumRefinementConcurrency = this.maximumRefinementConcurrency,
  ): void {
    this.assertNotDisposed();
    if (
      !Number.isInteger(maximumRefinementConcurrency) ||
      maximumRefinementConcurrency <= 0
    ) {
      throw new RangeError("maximumRefinementConcurrency must be a positive integer.");
    }
    if (
      maximumBasePreparationConcurrency ===
        this.basePreparationScheduler.maximumConcurrency &&
      maximumRefinementConcurrency === this.maximumRefinementConcurrency
    ) {
      return;
    }
    this.basePreparationScheduler.setMaximumConcurrency(
      maximumBasePreparationConcurrency,
    );
    this.maximumRefinementConcurrency = maximumRefinementConcurrency;
    this.applyRefinementPolicies();
    this.emit();
  }

  setPresentationQualityTarget(target: FrameQualityTarget): void {
    this.assertNotDisposed();
    this.validatePresentationQualityTarget(target);
    if (
      target.detailLevel === this.presentationQualityTarget.detailLevel &&
      target.minimumSplatCount === this.presentationQualityTarget.minimumSplatCount
    ) {
      return;
    }
    this.presentationQualityTarget = { ...target };
    for (const [frameIndex, record] of [...this.records]) {
      const selectedTransfer = selectFrameTransferQuality(
        record.source,
        target.detailLevel,
      );
      if (
        selectedTransfer !== undefined &&
        selectedTransfer.source.url !== record.preparedSource.url &&
        frameIndex !== this.currentFrameIndexValue
      ) {
        record.controller.abort();
        record.refinementController?.abort();
        if (record.preparedFrame !== undefined) {
          this.renderer.releaseFrame(record.preparedFrame);
        }
        this.records.delete(frameIndex);
        continue;
      }
      if (record.preparedFrame === undefined) {
        continue;
      }
      if (
        selectedTransfer !== undefined &&
        selectedTransfer.source.url !== record.preparedSource.url
      ) {
        // Keep the currently presented representation visible. The rolling window
        // will replace it after handoff instead of exposing an empty current slot.
        continue;
      }
      record.refinementController?.abort();
      record.refinementController = undefined;
      record.refinement = undefined;
      record.refinementEnabled = false;
      this.renderer.setFrameRefinement(record.preparedFrame, false);
      record.targetQualityLevel = 0;
      if (frameIndex !== this.currentFrameIndexValue) {
        record.status = "base-ready";
        record.qualityLevel = record.preparedFrame.qualityLevel;
      }
    }
    if (this.windowFrameIndexValue !== undefined) {
      this.reconcileWindow(this.windowFrameIndexValue, this.currentFrameIndexValue);
    }
    this.applyRefinementPolicies();
    this.emit();
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
    const presentationStartedAt = this.now();
    const requestRevision = this.presentationRequestRevision + 1;
    this.presentationRequestRevision = requestRevision;
    if (this.isAborted(options.signal)) {
      throw this.presentationAbortError();
    }
    this.trace({
      frameIndex: requestedFrameIndex,
      type: "presentation-requested",
    });
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
      this.trace({
        durationMs: this.now() - presentationStartedAt,
        errorMessage: this.errorMessage(error),
        frameIndex: requestedFrameIndex,
        type: "failed",
      });
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
      this.trace({
        durationMs: this.now() - presentationStartedAt,
        errorMessage: this.errorMessage(error),
        frameIndex,
        type: "failed",
      });
      throw error;
    }
    if (
      this.isAborted(options.signal) ||
      requestRevision !== this.presentationRequestRevision
    ) {
      throw this.presentationAbortError();
    }

    const presentationQuality =
      this.renderer.getFramePresentationQuality(preparedFrame);
    this.trace({
      durationMs: this.now() - presentationStartedAt,
      frameIndex,
      quality: this.copyQuality(presentationQuality),
      type: "presentation-ready",
    });

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
    this.trace({
      durationMs: this.now() - presentationStartedAt,
      frameIndex,
      quality: this.copyQuality(
        this.renderer.getFramePresentationQuality(preparedFrame),
      ),
      type: "presented",
    });
    this.reconcileWindow(frameIndex);
    this.emit();
    return preparedFrame;
  }

  async prepareForPresentation(requestedFrameIndex: number): Promise<PreparedFrame> {
    this.assertNotDisposed();
    const frameIndex = this.normaliseFrameIndex(requestedFrameIndex);
    this.reconcileWindow(frameIndex, this.currentFrameIndexValue);
    const preparedFrame = await this.ensureStableFrame(frameIndex);
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
      await this.ensureStableFrame(frameIndex);
      await this.ensurePresentationQuality(frameIndex);
    }
  }

  async whenBuffered(): Promise<void> {
    this.assertNotDisposed();
    const currentFrameIndex = this.currentFrameIndexValue ?? 0;
    const desired = this.desiredFrameIndices(currentFrameIndex);
    await Promise.all(
      [...desired].map((frameIndex) => this.ensureStableFrame(frameIndex)),
    );
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
    this.compressedFrameCache?.dispose();
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
    const selectedTransfer = selectFrameTransferQuality(
      source,
      this.presentationQualityTarget.detailLevel,
    );
    const preparedSource = selectedTransfer?.source ?? source;
    const baseRequestedAtMs = this.now();
    const requestedTransform = this.transformValue;
    const requestedTransformRevision = this.transformRevision;
    const temporalDistance = this.temporalDistance(frameIndex);
    const record = {} as FrameRecord;
    record.controller = controller;
    record.deadlineMs =
      baseRequestedAtMs + (temporalDistance / this.sequence.frameRate) * 1000;
    record.downloadedBytes = 0;
    record.qualityLevel = -1;
    record.refinementEnabled = false;
    record.preparedSource = preparedSource;
    record.requestedBytes = preparedSource.byteSize ?? 0;
    record.source = source;
    record.status = "loading-base";
    record.targetQualityLevel = 0;
    record.traceProgressKey = "";
    this.trace({
      frameIndex,
      loadedBytes: 0,
      totalBytes: record.requestedBytes,
      type: "base-requested",
    });
    const trace = (event: Omit<FrameRingBufferTraceEvent, "atMs" | "frameIndex">) => {
      this.trace({ ...event, frameIndex });
    };
    const codecId = preparedSource.codec ?? selectedTransfer?.quality.codec;
    const requiresExternalDecode = codecId !== undefined;
    const enqueueDecode = (cachedBytes?: ArrayBuffer) => {
      const decodeQueuedAtMs = this.now();
      return this.basePreparationScheduler.enqueue(
        () => ({
          deadlineMs: record.deadlineMs,
          estimatedBytes:
            record.requestedBytes > 0 ? record.requestedBytes : Number.MAX_SAFE_INTEGER,
          frameIndex,
          temporalDistance: this.preparationPriority(frameIndex),
        }),
        controller.signal,
        () => {
          this.trace({
            durationMs: this.now() - decodeQueuedAtMs,
            frameIndex,
            type: "base-started",
          });
          this.emit();
          const prepareRendererFrame = (decodedFrame?: DecodedGaussianFrame) =>
            this.renderer.prepareFrame(this.sequence.id, preparedSource, {
              ...(cachedBytes === undefined ? {} : { compressedBytes: cachedBytes }),
              ...(decodedFrame === undefined ? {} : { decodedFrame }),
              signal: controller.signal,
              minimumQualityOnly: true,
              onProgress: ({ loadedBytes, totalBytes }) => {
                record.downloadedBytes = loadedBytes;
                record.requestedBytes = totalBytes ?? record.requestedBytes;
                const progressKey = `${loadedBytes}:${record.requestedBytes}`;
                if (progressKey !== record.traceProgressKey) {
                  record.traceProgressKey = progressKey;
                  this.trace({
                    durationMs: this.now() - baseRequestedAtMs,
                    frameIndex,
                    loadedBytes,
                    totalBytes: record.requestedBytes,
                    type: "base-progress",
                  });
                }
                this.emit();
              },
              onTrace: ({
                chunkIndex,
                elapsedMs,
                pageIndex,
                phase,
                quality,
                reusedPage,
                stageDurationMs,
              }) => {
                this.trace({
                  ...(chunkIndex === undefined ? {} : { chunkIndex }),
                  durationMs: elapsedMs,
                  frameIndex,
                  ...(pageIndex === undefined ? {} : { pageIndex }),
                  phase,
                  ...(quality === undefined
                    ? {}
                    : { quality: this.copyQuality(quality) }),
                  ...(reusedPage === undefined ? {} : { reusedPage }),
                  ...(stageDurationMs === undefined ? {} : { stageDurationMs }),
                  type: "renderer-phase",
                });
              },
              ...(requestedTransform === undefined
                ? {}
                : { transform: requestedTransform }),
              ...(selectedTransfer === undefined
                ? {}
                : {
                    targetQualityLevel: selectedTransfer.quality.level,
                    transferQuality: selectedTransfer.quality,
                  }),
            });
          return codecId === undefined
            ? prepareRendererFrame()
            : this.decodeFrame(codecId, cachedBytes, controller.signal, trace).then(
                prepareRendererFrame,
              );
        },
      );
    };
    const basePreparation =
      this.compressedFrameCache === undefined ||
      (selectedTransfer === undefined && !requiresExternalDecode)
        ? enqueueDecode()
        : this.compressedFrameCache
            .get(
              this.toCompressedFrameRequest(frameIndex, preparedSource),
              controller.signal,
            )
            .then((cachedBytes) => enqueueDecode(cachedBytes));
    record.preparation = basePreparation
      .then((preparedFrame) => {
        if (requestedTransformRevision !== this.transformRevision) {
          this.renderer.setFrameTransform(preparedFrame, this.transformValue);
        }
        record.preparedFrame = preparedFrame;
        record.qualityLevel = preparedFrame.qualityLevel;
        record.status = "base-ready";
        const quality = this.renderer.getFramePresentationQuality(preparedFrame);
        this.applyQualitySnapshot(record, quality);
        this.trace({
          durationMs: this.now() - baseRequestedAtMs,
          frameIndex,
          quality: this.copyQuality(quality),
          type: "base-ready",
        });
        this.applyRefinementPolicies();
        this.emit();
        return preparedFrame;
      })
      .catch((error: unknown) => {
        record.status = controller.signal.aborted ? "expired" : "failed";
        if (!controller.signal.aborted) {
          this.trace({
            durationMs: this.now() - baseRequestedAtMs,
            errorMessage: this.errorMessage(error),
            frameIndex,
            type: "failed",
          });
        }
        this.emit();
        throw error;
      });
    this.records.set(frameIndex, record);
    this.emit();
    return record.preparation;
  }

  private async decodeFrame(
    codecId: string,
    cachedBytes: ArrayBuffer | undefined,
    signal: AbortSignal,
    trace: (event: Omit<FrameRingBufferTraceEvent, "atMs" | "frameIndex">) => void,
  ): Promise<DecodedGaussianFrame> {
    if (cachedBytes === undefined) {
      throw new Error(
        `Codec '${codecId}' requires the independent compressed-frame buffer.`,
      );
    }
    if (this.decoderRegistry === undefined || !this.decoderRegistry.has(codecId)) {
      throw new Error(`No Gaussian frame decoder is registered for '${codecId}'.`);
    }
    const decodeStartedAt = this.now();
    trace({ codecId, type: "codec-decode-started" });
    const decodedFrame = await this.decoderRegistry.decode(
      codecId,
      new Uint8Array(cachedBytes),
      { coordinateSystem: "RUB", signal },
    );
    trace({
      codecId,
      durationMs: this.now() - decodeStartedAt,
      type: "codec-decode-ready",
    });
    return decodedFrame;
  }

  /**
   * Adaptive quality may replace a queued or loading flat representation with a
   * different transfer tier. Callers already waiting for that frame should follow
   * the replacement record instead of surfacing the expected abort as a playback
   * failure.
   */
  private async ensureStableFrame(frameIndex: number): Promise<PreparedFrame> {
    while (true) {
      const preparation = this.ensureFrame(frameIndex);
      try {
        const preparedFrame = await preparation;
        if (this.records.get(frameIndex)?.preparation !== preparation) {
          continue;
        }
        return preparedFrame;
      } catch (error) {
        if (
          !this.disposed &&
          this.records.get(frameIndex)?.preparation !== preparation
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  private reconcileWindow(frameIndex: number, preservedFrameIndex?: number): void {
    this.windowFrameIndexValue = frameIndex;
    this.updateCompressedPrefetchPlan(frameIndex);
    const desired = this.desiredFrameIndices(frameIndex);
    if (preservedFrameIndex !== undefined) {
      desired.add(preservedFrameIndex);
      this.trimPreservedWindow(desired, frameIndex, preservedFrameIndex);
    }
    for (const [bufferedFrameIndex, record] of [...this.records]) {
      if (
        bufferedFrameIndex !== this.currentFrameIndexValue &&
        this.selectedTransferUrl(record.source) !== record.preparedSource.url
      ) {
        record.controller.abort();
        record.refinementController?.abort();
        if (record.preparedFrame !== undefined) {
          this.renderer.releaseFrame(record.preparedFrame);
        }
        this.records.delete(bufferedFrameIndex);
      }
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
        this.trace({
          frameIndex: bufferedFrameIndex,
          type: "evicted",
        });
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
    this.basePreparationScheduler.reprioritise();
    this.applyRefinementPolicies();
    this.trace({
      frames: [...this.records.values()]
        .map(({ source, status }) => ({ frameIndex: source.frameIndex, status }))
        .sort((a, b) => a.frameIndex - b.frameIndex),
      frameIndex,
      type: "window-updated",
    });
    this.emit();
  }

  private selectedTransferUrl(source: GaussianFrameSource): string {
    return (
      selectFrameTransferQuality(source, this.presentationQualityTarget.detailLevel)
        ?.source.url ?? source.url
    );
  }

  private updateCompressedPrefetchPlan(frameIndex: number): void {
    if (this.compressedFrameCache === undefined) {
      return;
    }
    const requests: CompressedFrameRequest[] = [];
    for (let offset = 0; offset < this.sequence.frameCount; offset += 1) {
      const requestedFrameIndex = this.offsetFrameIndex(frameIndex, offset);
      if (requestedFrameIndex === undefined) {
        break;
      }
      const source = this.sequence.frames[requestedFrameIndex];
      if (source === undefined) {
        continue;
      }
      const selectedTransfer = selectFrameTransferQuality(
        source,
        this.presentationQualityTarget.detailLevel,
      );
      const preparedSource = selectedTransfer?.source ?? source;
      if (selectedTransfer === undefined && preparedSource.codec === undefined) {
        continue;
      }
      requests.push(this.toCompressedFrameRequest(requestedFrameIndex, preparedSource));
    }
    this.compressedFrameCache.setPlan(requests);
  }

  private toCompressedFrameRequest(
    frameIndex: number,
    source: GaussianFrameSource,
  ): CompressedFrameRequest {
    return {
      ...(source.byteSize === undefined ? {} : { byteSize: source.byteSize }),
      frameIndex,
      url: source.url,
    };
  }

  private traceCompressedFetch(event: CompressedFrameCacheTraceEvent): void {
    const type =
      event.type === "fetch-started"
        ? "compressed-fetch-started"
        : event.type === "fetch-ready"
          ? "compressed-fetch-ready"
          : event.type === "cache-hit"
            ? "compressed-cache-hit"
            : "compressed-fetch-failed";
    this.trace({
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
      frameIndex: event.frameIndex,
      ...(event.loadedBytes === undefined ? {} : { loadedBytes: event.loadedBytes }),
      ...(event.totalBytes === undefined ? {} : { totalBytes: event.totalBytes }),
      type,
    });
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
    let unreadyFrameCount = 0;
    for (let offset = 1; offset < distance; offset += 1) {
      const frameIndex = this.offsetFrameIndex(windowFrameIndex, offset);
      if (frameIndex === undefined) {
        continue;
      }
      const status = this.records.get(frameIndex)?.status;
      if (status !== "ready" && status !== "presented") {
        unreadyFrameCount += 1;
        if (unreadyFrameCount >= this.maximumRefinementConcurrency) {
          return false;
        }
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
    const refinementStartedAtMs = this.now();
    record.refinementController = controller;
    record.refinementEnabled = true;
    record.status = "refining";
    record.targetQualityLevel = this.presentationQualityTarget.detailLevel;
    record.traceProgressKey = "";
    this.trace({
      frameIndex,
      quality: this.copyQuality(
        this.renderer.getFramePresentationQuality(preparedFrame),
      ),
      type: "refinement-started",
    });
    const refinement = this.renderer
      .refineFrame(preparedFrame, this.presentationQualityTarget, {
        signal: controller.signal,
        onProgress: (quality) => {
          if (record.refinementController === controller) {
            this.applyQualitySnapshot(record, quality);
            const progressKey = JSON.stringify(quality);
            if (progressKey !== record.traceProgressKey) {
              record.traceProgressKey = progressKey;
              this.trace({
                durationMs: this.now() - refinementStartedAtMs,
                frameIndex,
                quality: this.copyQuality(quality),
                type: "refinement-progress",
              });
            }
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
        this.trace({
          durationMs: this.now() - refinementStartedAtMs,
          frameIndex,
          quality: this.copyQuality(quality),
          type: "refinement-ready",
        });
        this.applyRefinementPolicies();
        this.emit();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && record.refinementController === controller) {
          record.status = "failed";
          this.trace({
            durationMs: this.now() - refinementStartedAtMs,
            errorMessage: this.errorMessage(error),
            frameIndex,
            type: "failed",
          });
          this.emit();
          throw error;
        } else if (controller.signal.aborted) {
          this.trace({
            durationMs: this.now() - refinementStartedAtMs,
            frameIndex,
            type: "refinement-cancelled",
          });
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
        // Refinement cancellation is expected when the rolling window or adaptive
        // quality target changes. A superseded refinement settles without making the
        // frame ready, so re-evaluate the current target and start/await its replacement.
        // Do not retry an obsolete presentation after another request moved the window;
        // its caller must unwind so the request-revision guard can report cancellation.
        // Real renderer failures still reject the refinement promise above.
        const windowFrameIndex = this.windowFrameIndexValue;
        const distance =
          windowFrameIndex === undefined
            ? -1
            : this.forwardDistanceFrom(windowFrameIndex, frameIndex);
        if (distance < 0 || distance > this.futureFrameCount) {
          throw new Error(
            `Frame ${frameIndex} is no longer in the presentation window.`,
          );
        }
        continue;
      }
      return;
    }
  }

  private meetsPresentationTarget(
    quality: Readonly<FramePresentationQuality>,
  ): boolean {
    return (
      quality.state === "presentable" &&
      (quality.achievedDetailLevel ?? quality.detailLevel) >=
        this.presentationQualityTarget.detailLevel &&
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
      record.qualityLevel = quality.achievedDetailLevel ?? quality.detailLevel;
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

  private preparationPriority(frameIndex: number): number {
    const anchorFrameIndex =
      this.windowFrameIndexValue ?? this.currentFrameIndexValue ?? 0;
    const forwardDistance = this.forwardDistanceFrom(anchorFrameIndex, frameIndex);
    if (forwardDistance >= 0 && forwardDistance <= this.futureFrameCount) {
      return forwardDistance;
    }
    return 1_000 + Math.abs(frameIndex - anchorFrameIndex);
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

  private copyQuality(
    quality: Readonly<FramePresentationQuality>,
  ): FramePresentationQuality {
    return { ...quality };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private trace(event: Omit<FrameRingBufferTraceEvent, "atMs">): void {
    if (this.onTrace === undefined || this.disposed) {
      return;
    }
    const traceEvent = Object.freeze({
      ...event,
      atMs: this.now(),
    });
    try {
      this.onTrace(traceEvent);
    } catch {
      // Diagnostic observers must never interrupt playback.
    }
  }

  private validatePresentationQualityTarget(target: FrameQualityTarget): void {
    if (
      !Number.isFinite(target.detailLevel) ||
      target.detailLevel <= 0 ||
      target.detailLevel > 1
    ) {
      throw new RangeError(
        "presentationQualityTarget.detailLevel must be greater than 0 and at most 1.",
      );
    }
    if (!Number.isInteger(target.minimumSplatCount) || target.minimumSplatCount < 0) {
      throw new RangeError(
        "presentationQualityTarget.minimumSplatCount must be a non-negative integer.",
      );
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
