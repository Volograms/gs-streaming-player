import { waitWithAbort } from "./abort.js";
import { SparkRendererAbortError, SparkRendererStateError } from "./errors.js";
import { applyTransform } from "./transform.js";

import type {
  FramePresentationQuality,
  FramePreparationOptions,
  FrameQualityTarget,
  FrameRefinementOptions,
  GaussianFrameSource,
  PreparedFrame,
  RendererFramePreparationPhase,
  RendererFramePreparationTraceEvent,
  RendererResourceMetrics,
} from "@6g-path/gaussian-player";
import type { Transform } from "@6g-path/shared";
import type { SplatMesh, SplatMeshOptions } from "@sparkjsdev/spark";
import type { Scene } from "three";

export type SparkFrameSlotState =
  "cancelled" | "empty" | "failed" | "loading" | "ready" | "released";

export interface SparkFrameSlotSnapshot {
  error?: unknown;
  frameIndex?: number;
  loadedBytes?: number;
  presentationQuality?: FramePresentationQuality;
  qualityLevel?: number;
  sequenceId?: string;
  slotId: number;
  source?: GaussianFrameSource;
  state: SparkFrameSlotState;
  totalBytes?: number;
  visible: boolean;
}

export interface SparkFrameSlotOptions {
  createSplatMesh(options: SplatMeshOptions): SplatMesh;
  getNow(): number;
  getRenderRevision(): number;
  invalidateLod(): void;
  scene: Scene;
  slotId: number;
}

interface FrameQualityInspection {
  demandKey: string;
  mappingVersion: number;
  settled: boolean;
  snapshot: FramePresentationQuality;
}

export class SparkFrameSlot {
  readonly slotId: number;
  private abortController: AbortController | undefined;
  private chunkBytesValue: readonly number[] = [];
  private committedLodScaleFractionValue = 1;
  private errorValue: unknown;
  private frameValue: PreparedFrame | undefined;
  private loadedBytesValue: number | undefined;
  private lodScaleValue = 1;
  private maximumSplatCountValue: number | undefined;
  private meshValue: SplatMesh | undefined;
  private readonly options: SparkFrameSlotOptions;
  private presentedValue = false;
  private sequenceIdValue: string | undefined;
  private sourceValue: GaussianFrameSource | undefined;
  private stateValue: SparkFrameSlotState = "empty";
  private totalBytesValue: number | undefined;
  private qualityTargetRevision = 0;
  private presentationReadyRevision = -1;
  private qualityTargetValue: FrameQualityTarget = {
    detailLevel: 0,
    minimumSplatCount: 0,
  };
  private warmLodScaleFractionValue = 0;

  constructor(options: SparkFrameSlotOptions) {
    this.options = options;
    this.slotId = options.slotId;
  }

  get frame(): PreparedFrame | undefined {
    return this.frameValue;
  }

  get mesh(): SplatMesh | undefined {
    return this.meshValue;
  }

  get snapshot(): SparkFrameSlotSnapshot {
    return {
      ...(this.errorValue === undefined ? {} : { error: this.errorValue }),
      ...(this.frameValue === undefined
        ? this.sequenceIdValue === undefined
          ? {}
          : { sequenceId: this.sequenceIdValue }
        : {
            frameIndex: this.frameValue.frameIndex,
            qualityLevel: this.frameValue.qualityLevel,
            sequenceId: this.frameValue.sequenceId,
          }),
      ...(this.loadedBytesValue === undefined
        ? {}
        : { loadedBytes: this.loadedBytesValue }),
      ...(this.meshValue === undefined
        ? {}
        : { presentationQuality: this.getPresentationQuality() }),
      slotId: this.slotId,
      ...(this.sourceValue === undefined ? {} : { source: this.sourceValue }),
      state: this.stateValue,
      ...(this.totalBytesValue === undefined
        ? {}
        : { totalBytes: this.totalBytesValue }),
      visible: this.presentedValue,
    };
  }

  get state(): SparkFrameSlotState {
    return this.stateValue;
  }

  async prepare(
    sequenceId: string,
    source: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame> {
    if (this.stateValue === "loading" || this.stateValue === "ready") {
      throw new SparkRendererStateError(
        `Frame slot ${this.slotId} already owns an active frame.`,
      );
    }
    if (this.stateValue === "released") {
      throw new SparkRendererStateError(`Frame slot ${this.slotId} has been released.`);
    }

    this.clearFrame();
    this.stateValue = "loading";
    this.sourceValue = source;
    this.sequenceIdValue = sequenceId;
    const controller = new AbortController();
    this.abortController = controller;
    const unlinkExternalSignal = this.linkExternalSignal(options.signal, controller);
    const preparationStartedAt = this.options.getNow();
    const trace = (
      phase: RendererFramePreparationPhase,
      quality?: FramePresentationQuality,
      details: Partial<
        Pick<
          RendererFramePreparationTraceEvent,
          "chunkIndex" | "pageIndex" | "reusedPage" | "stageDurationMs"
        >
      > = {},
    ) => {
      options.onTrace?.({
        ...details,
        elapsedMs: this.options.getNow() - preparationStartedAt,
        phase,
        ...(quality === undefined ? {} : { quality }),
      });
    };
    const reportedPreparationPhases = new Set<string>();
    const onPagedPreparation: NonNullable<
      NonNullable<SplatMesh["paged"]>["onPreparation"]
    > = ({ chunk, durationMs, page, phase, reusedPage }) => {
      const traceKey = `${phase}:${chunk ?? "shared"}`;
      if (reportedPreparationPhases.has(traceKey)) {
        return;
      }
      reportedPreparationPhases.add(traceKey);
      trace(phase, undefined, {
        ...(chunk === undefined ? {} : { chunkIndex: chunk }),
        ...(page === undefined ? {} : { pageIndex: page }),
        ...(reusedPage === undefined ? {} : { reusedPage }),
        stageDurationMs: durationMs,
      });
    };
    const installPreparationTrace = (mesh: SplatMesh) => {
      if (mesh.paged !== undefined) {
        mesh.paged.onPreparation = onPagedPreparation;
      }
    };

    try {
      const mesh = this.options.createSplatMesh({
        editable: false,
        onProgress: (event) => {
          if (controller.signal.aborted) {
            return;
          }
          this.loadedBytesValue = event.loaded;
          this.totalBytesValue = event.lengthComputable ? event.total : undefined;
          options.onProgress?.({
            ...(event.lengthComputable
              ? {
                  fraction: event.total === 0 ? 0 : event.loaded / event.total,
                  totalBytes: event.total,
                }
              : {}),
            loadedBytes: event.loaded,
            objectId: `${sequenceId}:${source.frameIndex}`,
            url: source.url,
          });
        },
        paged: true,
        url: source.url,
      });
      mesh.visible = false;
      this.meshValue = mesh;
      installPreparationTrace(mesh);
      trace("resource-created");
      await waitWithAbort(mesh.initialized, controller.signal, () => undefined);
      installPreparationTrace(mesh);
      trace("resource-initialized");
      if (this.isReleased()) {
        throw new SparkRendererStateError(`Frame slot ${this.slotId} was released.`);
      }
      await this.loadPagedMetadata(mesh, controller.signal);
      trace("metadata-ready");
      applyTransform(mesh, options.transform);
      this.options.scene.add(mesh);
      await this.waitForMinimumRenderablePage(mesh, controller.signal);
      trace("minimum-renderable", this.getPresentationQuality());
      const frame: PreparedFrame = {
        frameIndex: source.frameIndex,
        qualityLevel: options.targetQualityLevel ?? 0,
        rendererResource: this,
        sequenceId,
        source,
      };
      this.frameValue = frame;
      this.stateValue = "ready";
      return frame;
    } catch (error) {
      this.disposeMesh();
      if (!this.isReleased()) {
        this.errorValue = error;
        this.stateValue = controller.signal.aborted ? "cancelled" : "failed";
      }
      throw error;
    } finally {
      if (this.meshValue?.paged?.onPreparation === onPagedPreparation) {
        this.meshValue.paged.onPreparation = undefined;
      }
      unlinkExternalSignal();
      if (this.abortController === controller) {
        this.abortController = undefined;
      }
    }
  }

  present(): void {
    const mesh = this.requireReadyMesh();
    mesh.lodScale = this.lodScaleValue * this.committedLodScaleFractionValue;
    mesh.opacity = 1;
    mesh.visible = true;
    this.presentedValue = true;
    this.options.invalidateLod();
  }

  hide(): void {
    const mesh = this.requireReadyMesh();
    mesh.lodScale = 0;
    mesh.visible = false;
    this.presentedValue = false;
    this.options.invalidateLod();
  }

  warm(): void {
    const mesh = this.requireReadyMesh();
    mesh.lodScale = this.getWarmLodScale();
    mesh.opacity = 0;
    mesh.visible = true;
    this.presentedValue = false;
    this.options.invalidateLod();
  }

  refine(
    target: FrameQualityTarget,
    options: FrameRefinementOptions = {},
  ): Promise<FramePresentationQuality> {
    if (
      !Number.isFinite(target.detailLevel) ||
      target.detailLevel <= 0 ||
      target.detailLevel > 1
    ) {
      throw new RangeError("Frame detailLevel must be greater than 0 and at most 1.");
    }
    if (!Number.isInteger(target.minimumSplatCount) || target.minimumSplatCount < 0) {
      throw new RangeError("minimumSplatCount must be a non-negative integer.");
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(new SparkRendererAbortError());
    }

    const mesh = this.requireReadyMesh();
    if (
      this.maximumSplatCountValue !== undefined &&
      target.minimumSplatCount > this.maximumSplatCountValue
    ) {
      return Promise.reject(
        new SparkRendererStateError(
          `Frame has at most ${this.maximumSplatCountValue} splats, below the requested minimum of ${target.minimumSplatCount}.`,
        ),
      );
    }
    const revision = this.qualityTargetRevision + 1;
    this.qualityTargetRevision = revision;
    this.presentationReadyRevision = -1;
    this.qualityTargetValue = { ...target };
    this.warmLodScaleFractionValue = target.detailLevel;
    mesh.lodScale = this.lodScaleValue * target.detailLevel;
    this.options.invalidateLod();

    if (mesh.paged === undefined) {
      if (mesh.numSplats < target.minimumSplatCount) {
        return Promise.reject(
          new SparkRendererStateError(
            `Frame has ${mesh.numSplats} splats, below the requested minimum of ${target.minimumSplatCount}.`,
          ),
        );
      }
      this.committedLodScaleFractionValue = target.detailLevel;
      this.presentationReadyRevision = revision;
      const snapshot = this.getPresentationQuality();
      options.onProgress?.(snapshot);
      return Promise.resolve(snapshot);
    }

    const startingMappingVersion = mesh.mappingVersion;
    const startingRenderRevision = this.options.getRenderRevision();
    return new Promise<FramePresentationQuality>((resolve, reject) => {
      let candidate: { demandKey: string; renderRevision: number } | undefined;
      let lastProgressKey = "";
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        options.signal?.removeEventListener("abort", handleAbort);
      };
      const handleAbort = () => {
        cleanup();
        reject(new SparkRendererAbortError());
      };
      const scheduleCheck = (delay = 16) => {
        timer = setTimeout(check, delay);
      };
      const check = () => {
        if (options.signal?.aborted === true) {
          handleAbort();
          return;
        }
        if (revision !== this.qualityTargetRevision || this.isReleased()) {
          cleanup();
          reject(new SparkRendererAbortError("Frame refinement was superseded."));
          return;
        }

        const inspection = this.inspectPresentationQuality();
        const progressKey = JSON.stringify(inspection.snapshot);
        if (progressKey !== lastProgressKey) {
          lastProgressKey = progressKey;
          options.onProgress?.(inspection.snapshot);
        }

        const renderRevision = this.options.getRenderRevision();
        if (inspection.settled && renderRevision > startingRenderRevision) {
          if (
            candidate !== undefined &&
            inspection.demandKey === candidate.demandKey &&
            renderRevision > candidate.renderRevision &&
            (inspection.mappingVersion > startingMappingVersion ||
              renderRevision >= candidate.renderRevision + 2)
          ) {
            this.committedLodScaleFractionValue = target.detailLevel;
            this.presentationReadyRevision = revision;
            cleanup();
            const snapshot = this.getPresentationQuality();
            options.onProgress?.(snapshot);
            resolve(snapshot);
            return;
          }
          if (candidate === undefined || inspection.demandKey !== candidate.demandKey) {
            candidate = {
              demandKey: inspection.demandKey,
              renderRevision,
            };
          }
          this.options.invalidateLod();
        } else {
          candidate = undefined;
          this.options.invalidateLod();
        }
        scheduleCheck(16);
      };

      options.signal?.addEventListener("abort", handleAbort, { once: true });
      check();
    });
  }

  getPresentationQuality(): FramePresentationQuality {
    const inspection = this.inspectPresentationQuality();
    const presentable =
      this.presentationReadyRevision === this.qualityTargetRevision &&
      inspection.settled;
    return {
      ...inspection.snapshot,
      achievedDetailLevel: presentable ? this.qualityTargetValue.detailLevel : 0,
      requestedDetailLevel: this.qualityTargetValue.detailLevel,
      ...(presentable ? { state: "presentable" } : {}),
    };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  setLodScale(scale: number): void {
    this.lodScaleValue = scale;
    const mesh = this.meshValue;
    if (mesh !== undefined) {
      mesh.lodScale = this.presentedValue
        ? scale * this.committedLodScaleFractionValue
        : this.getWarmLodScale();
      this.options.invalidateLod();
    }
  }

  setWarmLodScaleFraction(fraction: number): void {
    this.warmLodScaleFractionValue = Math.max(0, fraction);
    this.qualityTargetRevision += 1;
    this.presentationReadyRevision = -1;
    this.qualityTargetValue = {
      detailLevel: this.warmLodScaleFractionValue,
      minimumSplatCount: 0,
    };
    const mesh = this.meshValue;
    if (mesh !== undefined && !this.presentedValue) {
      mesh.lodScale = this.getWarmLodScale();
      this.options.invalidateLod();
    }
  }

  setTransform(transform?: Transform): void {
    const mesh = this.requireReadyMesh();
    applyTransform(mesh, transform);
    this.qualityTargetRevision += 1;
    this.presentationReadyRevision = -1;
    this.options.invalidateLod();
  }

  setMaximumSphericalHarmonics(maximum: 0 | 1 | 2 | 3): void {
    const mesh = this.meshValue;
    if (mesh !== undefined && mesh.maxSh !== maximum) {
      mesh.maxSh = maximum;
      mesh.updateGenerator();
    }
  }

  getResourceMetrics(): RendererResourceMetrics | undefined {
    if (this.sourceValue === undefined || this.frameValue === undefined) {
      if (this.stateValue !== "loading" || this.sourceValue === undefined) {
        return undefined;
      }
    }

    const sequenceId = this.sequenceIdValue ?? "pending";
    return {
      id: `${sequenceId}:${this.sourceValue.frameIndex}:slot-${this.slotId}`,
      kind: "dynamic-frame",
      ...(this.loadedBytesValue === undefined
        ? {}
        : { loadedBytes: this.loadedBytesValue }),
      state: this.stateValue === "ready" ? "ready" : "loading",
      ...(this.totalBytesValue === undefined
        ? {}
        : { totalBytes: this.totalBytesValue }),
      url: this.sourceValue.url,
      visible: this.presentedValue,
    };
  }

  release(): void {
    if (this.stateValue === "released") {
      return;
    }
    this.stateValue = "released";
    this.qualityTargetRevision += 1;
    this.abortController?.abort();
    this.disposeMesh();
    this.frameValue = undefined;
    this.presentedValue = false;
    this.sequenceIdValue = undefined;
  }

  private clearFrame(): void {
    this.disposeMesh();
    this.errorValue = undefined;
    this.chunkBytesValue = [];
    this.committedLodScaleFractionValue = 1;
    this.frameValue = undefined;
    this.loadedBytesValue = undefined;
    this.maximumSplatCountValue = undefined;
    this.presentedValue = false;
    this.sourceValue = undefined;
    this.sequenceIdValue = undefined;
    this.totalBytesValue = undefined;
    this.presentationReadyRevision = -1;
    this.qualityTargetRevision += 1;
    this.qualityTargetValue = { detailLevel: 0, minimumSplatCount: 0 };
  }

  private disposeMesh(): void {
    const mesh = this.meshValue;
    if (mesh !== undefined) {
      this.meshValue = undefined;
      mesh.removeFromParent();
      mesh.dispose();
    }
  }

  private async loadPagedMetadata(mesh: SplatMesh, signal: AbortSignal): Promise<void> {
    const paged = mesh.paged;
    if (paged === undefined || typeof paged.getRadMeta !== "function") {
      return;
    }
    const { meta } = await waitWithAbort(paged.getRadMeta(), signal, () => undefined);
    this.chunkBytesValue = meta.chunks.map(({ bytes }) => bytes);
    this.maximumSplatCountValue = meta.count;
    this.totalBytesValue = this.chunkBytesValue.reduce(
      (total, bytes) => total + bytes,
      0,
    );
  }

  private inspectPresentationQuality(): FrameQualityInspection {
    const mesh = this.meshValue;
    const detailLevel = this.qualityTargetValue.detailLevel;
    if (mesh === undefined) {
      return {
        demandKey: "",
        mappingVersion: 0,
        settled: false,
        snapshot: { detailLevel, state: "refining" },
      };
    }

    const paged = mesh.paged;
    if (paged === undefined) {
      const selectedSplatCount = mesh.numSplats;
      const settled =
        this.stateValue === "ready" &&
        selectedSplatCount >= this.qualityTargetValue.minimumSplatCount;
      return {
        demandKey: "non-paged",
        mappingVersion: mesh.mappingVersion,
        settled,
        snapshot: {
          achievedDetailLevel: settled ? detailLevel : 0,
          detailLevel,
          requestedDetailLevel: detailLevel,
          selectedSplatCount,
          state: settled ? "presentable" : "refining",
        },
      };
    }

    const pager = paged.pager;
    const mappings = pager?.splatsChunkToPage?.get(paged) ?? [];
    const pendingUploadPages = new Set<number>([
      ...(pager?.newUploads ?? []).map(({ page }) => page),
      ...(pager?.readyUploads ?? []).map(({ page }) => page),
    ]);
    const residentChunks = new Set<number>();
    const frameUploadPendingPages = new Set<number>();
    let loadedBytes = 0;
    mappings.forEach((mapping, chunk) => {
      if (mapping !== undefined) {
        if (pendingUploadPages.has(mapping.page)) {
          frameUploadPendingPages.add(mapping.page);
        } else {
          residentChunks.add(chunk);
          loadedBytes += this.chunkBytesValue[chunk] ?? 0;
        }
      }
    });

    const demandedChunks = new Set<number>([0]);
    for (const priority of pager?.fetchPriority ?? []) {
      if (priority.splats === paged) {
        demandedChunks.add(priority.chunk);
      }
    }
    const fetchingPageCount = (pager?.fetchers ?? []).filter(
      ({ chunk, splats }) => splats === paged && demandedChunks.has(chunk),
    ).length;
    const fetchedPageCount = (pager?.fetched ?? []).filter(
      ({ chunk, splats }) => splats === paged && demandedChunks.has(chunk),
    ).length;
    const pendingTreeUpdateCount = (pager?.lodTreeUpdates ?? []).filter(
      ({ chunk, splats }) => splats === paged && demandedChunks.has(chunk),
    ).length;
    const demandedResident = [...demandedChunks].every((chunk) =>
      residentChunks.has(chunk),
    );
    const rootReady = residentChunks.has(0);
    const selectedSplatCount = paged.numSplats;
    const settled =
      rootReady &&
      demandedResident &&
      fetchingPageCount === 0 &&
      fetchedPageCount === 0 &&
      pendingTreeUpdateCount === 0 &&
      selectedSplatCount >= this.qualityTargetValue.minimumSplatCount;
    const totalBytes =
      this.chunkBytesValue.length === 0
        ? undefined
        : this.chunkBytesValue.reduce((total, bytes) => total + bytes, 0);

    return {
      demandKey: [...demandedChunks].sort((a, b) => a - b).join(","),
      mappingVersion: mesh.mappingVersion,
      settled,
      snapshot: {
        achievedDetailLevel: 0,
        demandedPageCount: demandedChunks.size,
        detailLevel,
        fetchingPageCount: fetchingPageCount + fetchedPageCount,
        ...(this.chunkBytesValue.length === 0 ? {} : { loadedBytes }),
        ...(this.maximumSplatCountValue === undefined
          ? {}
          : { maximumSplatCount: this.maximumSplatCountValue }),
        residentPageCount: residentChunks.size,
        selectedSplatCount,
        state: rootReady && detailLevel === 0 ? "root-ready" : "refining",
        ...(totalBytes === undefined ? {} : { totalBytes }),
        uploadPendingPageCount: frameUploadPendingPages.size + pendingTreeUpdateCount,
        requestedDetailLevel: detailLevel,
      },
    };
  }

  private waitForMinimumRenderablePage(
    mesh: SplatMesh,
    signal: AbortSignal,
  ): Promise<void> {
    const paged = mesh.paged;
    if (paged === undefined) {
      return Promise.resolve();
    }

    // Spark only pages scene-visible generators. Keep the slot transparent while its
    // root LoD page is fetched so preparation cannot expose a partially ready frame.
    mesh.opacity = 0;
    mesh.lodScale = this.getWarmLodScale();
    mesh.visible = true;
    this.options.invalidateLod();

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let explicitPreparationStarted = false;
      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        signal.removeEventListener("abort", handleAbort);
      };
      const handleAbort = () => {
        cleanup();
        reject(new SparkRendererAbortError());
      };
      const check = () => {
        if (signal.aborted) {
          handleAbort();
          return;
        }
        const pager = paged.pager;
        if (
          pager !== undefined &&
          !explicitPreparationStarted &&
          typeof pager.prepareChunk === "function"
        ) {
          explicitPreparationStarted = true;
          void pager
            .prepareChunk(paged, 0, { signal })
            .then(check, (error: unknown) => {
              cleanup();
              reject(signal.aborted ? new SparkRendererAbortError() : error);
            });
          return;
        }
        const rootPage = pager?.getSplatsChunk(paged, 0);
        const rootUploadPending =
          rootPage !== undefined &&
          (pager?.newUploads?.some(({ page }) => page === rootPage.page) === true ||
            pager?.readyUploads?.some(({ page }) => page === rootPage.page) === true);
        if (rootPage !== undefined && !rootUploadPending) {
          cleanup();
          resolve();
          return;
        }
        timer = setTimeout(check, 16);
      };

      signal.addEventListener("abort", handleAbort, { once: true });
      check();
    });
  }

  private linkExternalSignal(
    signal: AbortSignal | undefined,
    controller: AbortController,
  ): () => void {
    if (signal === undefined) {
      return () => undefined;
    }
    if (signal.aborted) {
      controller.abort();
      return () => undefined;
    }
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    return () => signal.removeEventListener("abort", abort);
  }

  private getWarmLodScale(): number {
    return this.lodScaleValue * this.warmLodScaleFractionValue;
  }

  private requireReadyMesh(): SplatMesh {
    if (this.stateValue !== "ready" || this.meshValue === undefined) {
      throw new SparkRendererStateError(`Frame slot ${this.slotId} is not ready.`);
    }
    return this.meshValue;
  }

  private isReleased(): boolean {
    return this.stateValue === "released";
  }
}
