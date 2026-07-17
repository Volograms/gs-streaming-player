import { PerspectiveCamera } from "three";

import { throwIfAborted, waitWithAbort } from "./abort.js";
import { disposeObject } from "./disposeObject.js";
import { SparkRendererAbortError, SparkRendererStateError } from "./errors.js";
import {
  cloneSparkRenderQuality,
  DEFAULT_SPARK_RENDER_QUALITY,
  validateSparkRenderQuality,
} from "./quality.js";
import { defaultSparkRendererRuntime } from "./runtime.js";
import { SparkFlatFrameDisplay } from "./SparkFlatFrameDisplay.js";
import { SparkFrameSlot } from "./SparkFrameSlot.js";
import { applyTransform } from "./transform.js";

import type { SparkRenderQualityConfiguration } from "./quality.js";
import type { ResizeObserverLike, SparkRendererRuntime } from "./runtime.js";
import type { SparkFrameSlotSnapshot } from "./SparkFrameSlot.js";
import type { SparkRendererAdapterOptions, SparkRenderTimingSample } from "./types.js";
import type {
  FramePresentationQuality,
  FramePreparationOptions,
  FrameQualityTarget,
  FrameRefinementOptions,
  GaussianFrameSource,
  GaussianRendererAdapter,
  MeshSceneObject,
  PreparedFrame,
  QualityDecision,
  RendererLoadOptions,
  RendererLoadProgressCallback,
  RendererMetrics,
  RendererObjectHandle,
  RendererObjectKind,
  RendererResourceKind,
  RendererResourceMetrics,
  StaticSceneObject,
} from "@6g-path/gaussian-player";
import type { Transform } from "@6g-path/shared";
import type { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { Camera, Object3D, Scene, WebGLRenderer } from "three";

interface LoadedObjectRecord {
  dispose(): void;
  id: string;
  kind: RendererObjectKind;
  node: Object3D;
  splatMesh?: SplatMesh;
}

interface MutableResourceMetrics {
  id: string;
  kind: RendererResourceKind;
  loadedBytes?: number;
  state: "loading" | "ready";
  totalBytes?: number;
  url: string;
  visible: boolean;
}

interface InstrumentableSparkRenderer {
  display?: { mappingVersion: number };
  updateInternal(...args: unknown[]): Promise<unknown>;
}

export class SparkGaussianRendererAdapter implements GaussianRendererAdapter {
  private readonly autoRender: boolean;
  private failedResourceLoadCount = 0;
  private readonly displayCommitIntervalsMs: number[] = [];
  private readonly flatFrameCopySamplesMs: number[] = [];
  private flatFrameCopyTimeMs: number | undefined;
  private flatFrameDisplayValue: SparkFlatFrameDisplay | undefined;
  private readonly frameSlots = new Set<SparkFrameSlot>();
  private readonly loadedObjects = new Map<string, LoadedObjectRecord>();
  private readonly loadingObjectIds = new Set<string>();
  private readonly manageResize: boolean;
  private readonly options: SparkRendererAdapterOptions;
  private nextFrameSlotId = 0;
  private readonly preparedFrames = new Map<PreparedFrame, SparkFrameSlot>();
  private qualityConfiguration = cloneSparkRenderQuality(DEFAULT_SPARK_RENDER_QUALITY);
  private readonly resourceMetrics = new Map<string, MutableResourceMetrics>();
  private readonly runtime: SparkRendererRuntime;
  private activeFrame: PreparedFrame | undefined;
  private cameraValue: Camera | undefined;
  private disposed = false;
  private frameTimeMs: number | undefined;
  private initialised = false;
  private lastDisplayCommitAt: number | undefined;
  private lastDisplayMappingVersion: number | undefined;
  private lastRenderTime: number | undefined;
  private rendererValue: WebGLRenderer | undefined;
  private renderFramesPerSecond: number | undefined;
  private readonly renderCallSamplesMs: number[] = [];
  private renderCallTimeMs: number | undefined;
  private readonly renderIntervalSamplesMs: number[] = [];
  private renderRevision = 0;
  private renderTimingBatchStartedAt: number | undefined;
  private resizeObserver: ResizeObserverLike | undefined;
  private sceneValue: Scene | undefined;
  private sparkValue: SparkRenderer | undefined;
  private sortTimeMs: number | undefined;
  private readonly sortOrderingUploadSamplesMs: number[] = [];
  private readonly sortReadbackSamplesMs: number[] = [];
  private readonly sortSamplesMs: number[] = [];
  private readonly sortWorkerSamplesMs: number[] = [];
  private sparkUpdateTimeMs: number | undefined;
  private readonly sparkUpdateSamplesMs: number[] = [];
  private startedAnimationLoop = false;

  constructor(options: SparkRendererAdapterOptions) {
    this.options = options;
    this.runtime = options.runtime ?? defaultSparkRendererRuntime;
    this.autoRender = options.autoRender ?? options.renderer === undefined;
    this.manageResize = options.manageResize ?? options.renderer === undefined;
  }

  get camera(): Camera {
    return this.requireInitialised(this.cameraValue, "camera");
  }

  get renderer(): WebGLRenderer {
    return this.requireInitialised(this.rendererValue, "renderer");
  }

  get scene(): Scene {
    return this.requireInitialised(this.sceneValue, "scene");
  }

  async initialise(): Promise<void> {
    this.assertNotDisposed();
    if (this.initialised) {
      return;
    }

    const renderer = this.createOrUseRenderer();
    let spark: SparkRenderer | undefined;
    try {
      const scene = this.options.scene ?? this.runtime.createScene();
      const camera = this.options.camera ?? this.runtime.createCamera();
      spark = this.runtime.createSparkRenderer(renderer);
      this.installRenderInstrumentation(spark);

      scene.add(spark);
      this.rendererValue = renderer;
      this.sceneValue = scene;
      this.cameraValue = camera;
      this.sparkValue = spark;
      this.flatFrameDisplayValue = new SparkFlatFrameDisplay({
        createSplatMesh: (flatOptions) => this.runtime.createSplatMesh(flatOptions),
        scene,
      });
      this.initialised = true;
      this.applyQualityConfiguration();

      if (this.manageResize) {
        this.resize();
        this.resizeObserver = this.runtime.createResizeObserver(() => this.resize());
        this.resizeObserver?.observe(renderer.domElement);
      }

      if (this.autoRender) {
        this.start();
      }
    } catch (error) {
      spark?.removeFromParent();
      spark?.dispose();
      if (this.options.renderer === undefined) {
        renderer.dispose();
      }
      this.initialised = false;
      this.rendererValue = undefined;
      this.sceneValue = undefined;
      this.cameraValue = undefined;
      this.sparkValue = undefined;
      throw error;
    }
  }

  async loadStaticObject(
    object: StaticSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    this.assertReadyForLoad(object.id, options.signal);
    this.loadingObjectIds.add(object.id);
    const resource = this.beginResource(object.id, "static-splat", object.url);
    let splatMesh: SplatMesh | undefined;

    try {
      const onProgress = this.createProgressReporter(
        object,
        options.onProgress,
        options.signal,
        resource,
      );
      splatMesh = this.runtime.createSplatMesh({
        editable: false,
        ...(onProgress === undefined ? {} : { onProgress }),
        paged: true,
        url: object.url,
      });
      await waitWithAbort(splatMesh.initialized, options.signal, () => undefined);
      this.assertNotDisposed();
      applyTransform(splatMesh, object.transform);
      this.scene.add(splatMesh);
      resource.state = "ready";
      resource.visible = true;
      const loadedSplatMesh = splatMesh;
      this.loadedObjects.set(object.id, {
        dispose: () => loadedSplatMesh.dispose(),
        id: object.id,
        kind: "static-splat",
        node: loadedSplatMesh,
        splatMesh: loadedSplatMesh,
      });
      this.applyQualityToStaticObject(object.id, loadedSplatMesh);
      splatMesh = undefined;
      return Object.freeze({ id: object.id, kind: "static-splat" });
    } catch (error) {
      this.resourceMetrics.delete(object.id);
      if (!(error instanceof SparkRendererAbortError)) {
        this.failedResourceLoadCount += 1;
      }
      splatMesh?.removeFromParent();
      splatMesh?.dispose();
      throw error;
    } finally {
      this.loadingObjectIds.delete(object.id);
    }
  }

  async loadMesh(
    object: MeshSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    this.assertReadyForLoad(object.id, options.signal);
    this.loadingObjectIds.add(object.id);
    const resource = this.beginResource(object.id, "mesh", object.url);
    let meshRoot: Object3D | undefined;

    try {
      const load = this.runtime
        .createGltfLoader()
        .loadAsync(
          object.url,
          this.createProgressReporter(
            object,
            options.onProgress,
            options.signal,
            resource,
          ),
        );
      const gltf = await waitWithAbort(load, options.signal, (abortedGltf) =>
        disposeObject(abortedGltf.scene),
      );
      this.assertNotDisposed();
      meshRoot = gltf.scene;
      applyTransform(meshRoot, object.transform);
      this.scene.add(meshRoot);
      resource.state = "ready";
      resource.visible = true;
      const loadedMeshRoot = meshRoot;
      this.loadedObjects.set(object.id, {
        dispose: () => disposeObject(loadedMeshRoot),
        id: object.id,
        kind: "mesh",
        node: loadedMeshRoot,
      });
      meshRoot = undefined;
      return Object.freeze({ id: object.id, kind: "mesh" });
    } catch (error) {
      this.resourceMetrics.delete(object.id);
      if (!(error instanceof SparkRendererAbortError)) {
        this.failedResourceLoadCount += 1;
      }
      meshRoot?.removeFromParent();
      if (meshRoot !== undefined) {
        disposeObject(meshRoot);
      }
      throw error;
    } finally {
      this.loadingObjectIds.delete(object.id);
    }
  }

  async prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame> {
    this.assertInitialised();
    throwIfAborted(options.signal);
    const slot = new SparkFrameSlot({
      createSplatMesh: (slotOptions) => this.runtime.createSplatMesh(slotOptions),
      getNow: () => this.runtime.now(),
      getRenderRevision: () => this.renderRevision,
      invalidateLod: () => this.invalidateLod(),
      scene: this.scene,
      slotId: this.nextFrameSlotId,
    });
    this.nextFrameSlotId += 1;
    this.frameSlots.add(slot);

    try {
      const preparedFrame = await slot.prepare(sequenceId, frame, options);
      this.assertNotDisposed();
      this.preparedFrames.set(preparedFrame, slot);
      this.applyQualityToFrameSlot(slot);
      return preparedFrame;
    } catch (error) {
      if (slot.state === "failed") {
        this.failedResourceLoadCount += 1;
      }
      slot.release();
      this.frameSlots.delete(slot);
      throw error;
    }
  }

  presentFrame(frame: PreparedFrame): void {
    const slot = this.requirePreparedFrame(frame);
    if (this.activeFrame !== undefined && this.activeFrame !== frame) {
      this.requirePreparedFrame(this.activeFrame).warm();
    }
    if (slot.isFlat) {
      const sourceMesh = slot.mesh;
      if (sourceMesh === undefined) {
        throw new SparkRendererStateError("Flat frame source mesh is unavailable.");
      }
      const copy = this.requireInitialised(
        this.flatFrameDisplayValue,
        "Flat frame display",
      ).present(sourceMesh, () => this.runtime.now());
      this.flatFrameCopyTimeMs = copy.durationMs;
      this.flatFrameCopySamplesMs.push(copy.durationMs);
    } else {
      this.flatFrameDisplayValue?.hide();
    }
    slot.present();
    this.activeFrame = frame;
  }

  hideFrame(frame: PreparedFrame): void {
    const slot = this.requirePreparedFrame(frame);
    slot.hide();
    if (this.activeFrame === frame) {
      if (slot.isFlat) {
        this.flatFrameDisplayValue?.hide();
      }
      this.activeFrame = undefined;
    }
  }

  releaseFrame(frame: PreparedFrame): void {
    const slot = this.requirePreparedFrame(frame);
    this.preparedFrames.delete(frame);
    this.frameSlots.delete(slot);
    slot.release();
    if (this.activeFrame === frame) {
      if (slot.isFlat) {
        this.flatFrameDisplayValue?.hide();
      }
      this.activeFrame = undefined;
    }
  }

  setObjectTransform(objectId: string, transform: Transform): void {
    const object = this.requireLoadedObject(objectId);
    applyTransform(object.node, transform);
    if (object.splatMesh !== undefined) {
      this.invalidateLod();
    }
  }

  setObjectVisibility(objectId: string, visible: boolean): void {
    this.requireLoadedObject(objectId).node.visible = visible;
    const resource = this.resourceMetrics.get(objectId);
    if (resource !== undefined) {
      resource.visible = visible;
    }
  }

  releaseObject(objectId: string): void {
    const object = this.requireLoadedObject(objectId);
    this.loadedObjects.delete(objectId);
    this.resourceMetrics.delete(objectId);
    object.node.removeFromParent();
    object.dispose();
  }

  setRenderQuality(decision: QualityDecision): void {
    this.setSparkRenderQuality({
      ...this.qualityConfiguration,
      dynamicSequenceWeights: this.normaliseWeights(decision.dynamicObjectWeights),
      objectWeights: this.qualityConfiguration.objectWeights,
      splatBudget: Math.max(1, Math.floor(decision.renderSplatBudget)),
      staticSceneWeight: this.normaliseWeight(decision.staticObjectWeight),
    });
  }

  setSparkRenderQuality(configuration: SparkRenderQualityConfiguration): void {
    this.assertInitialised();
    validateSparkRenderQuality(configuration);
    this.qualityConfiguration = cloneSparkRenderQuality(configuration);
    this.applyQualityConfiguration();
  }

  getSparkRenderQuality(): SparkRenderQualityConfiguration {
    return cloneSparkRenderQuality(this.qualityConfiguration);
  }

  getFrameSlotSnapshots(): readonly SparkFrameSlotSnapshot[] {
    return [...this.frameSlots].map((slot) => slot.snapshot);
  }

  refineFrame(
    frame: PreparedFrame,
    target: FrameQualityTarget,
    options?: FrameRefinementOptions,
  ): Promise<FramePresentationQuality> {
    return this.requirePreparedFrame(frame).refine(target, options);
  }

  getFramePresentationQuality(frame: PreparedFrame): FramePresentationQuality {
    return this.requirePreparedFrame(frame).getPresentationQuality();
  }

  setFrameRefinement(frame: PreparedFrame, enabled: boolean): void {
    this.requirePreparedFrame(frame).setWarmLodScaleFraction(enabled ? 1 : 0);
  }

  setFrameTransform(frame: PreparedFrame, transform?: Transform): void {
    const slot = this.requirePreparedFrame(frame);
    slot.setTransform(transform);
    if (slot.isFlat && this.activeFrame === frame && slot.mesh !== undefined) {
      this.flatFrameDisplayValue?.updateTransform(slot.mesh);
    }
  }

  getMetrics(): RendererMetrics {
    const objects = [...this.loadedObjects.values()];
    const spark = this.sparkValue;
    const frameResources = [...this.frameSlots]
      .map((slot) => slot.getResourceMetrics())
      .filter(
        (resource): resource is RendererResourceMetrics => resource !== undefined,
      );
    const resources: RendererResourceMetrics[] = [
      ...this.resourceMetrics.values(),
      ...frameResources,
    ].map((resource) => ({ ...resource }));
    const pager = spark?.pager;
    return {
      ...(this.activeFrame === undefined
        ? {}
        : { activeFrameIndex: this.activeFrame.frameIndex }),
      ...(this.flatFrameDisplayValue?.capacity === undefined
        ? {}
        : { dynamicGpuCapacity: this.flatFrameDisplayValue.capacity }),
      ...(this.flatFrameDisplayValue === undefined
        ? {}
        : {
            dynamicGpuReallocationCount: this.flatFrameDisplayValue.reallocationCount,
          }),
      ...(this.frameTimeMs === undefined ? {} : { frameTimeMs: this.frameTimeMs }),
      failedResourceLoadCount: this.failedResourceLoadCount,
      ...(this.flatFrameCopyTimeMs === undefined
        ? {}
        : { flatFrameCopyTimeMs: this.flatFrameCopyTimeMs }),
      ...(pager === undefined ? {} : { gpuPageCapacity: pager.maxPages }),
      ...(pager === undefined
        ? {}
        : {
            gpuPageCount: pager.pageToSplatsChunk.reduce(
              (count, page) => count + (page === undefined ? 0 : 1),
              0,
            ),
          }),
      loadedMeshObjectCount: objects.filter(({ kind }) => kind === "mesh").length,
      loadedStaticObjectCount: objects.filter(({ kind }) => kind === "static-splat")
        .length,
      loadingResourceCount: resources.filter(({ state }) => state === "loading").length,
      preparedFrameCount: [...this.frameSlots].filter(({ state }) => state === "ready")
        .length,
      ...(spark === undefined ? {} : { renderedSplatCount: spark.activeSplats }),
      ...(this.renderFramesPerSecond === undefined
        ? {}
        : { renderFramesPerSecond: this.renderFramesPerSecond }),
      ...(this.renderCallTimeMs === undefined
        ? {}
        : { renderCallTimeMs: this.renderCallTimeMs }),
      resources,
      ...(this.sortTimeMs === undefined ? {} : { sortTimeMs: this.sortTimeMs }),
      ...(this.sparkUpdateTimeMs === undefined
        ? {}
        : { sparkUpdateTimeMs: this.sparkUpdateTimeMs }),
    };
  }

  render = (): void => {
    this.assertInitialised();
    const renderStartedAt = this.runtime.now();
    let renderIntervalMs: number | undefined;
    if (this.lastRenderTime !== undefined) {
      this.frameTimeMs = renderStartedAt - this.lastRenderTime;
      renderIntervalMs = this.frameTimeMs;
      this.renderIntervalSamplesMs.push(renderIntervalMs);
      this.renderFramesPerSecond =
        this.frameTimeMs > 0 ? 1000 / this.frameTimeMs : undefined;
    }
    this.lastRenderTime = renderStartedAt;
    this.renderer.render(this.scene, this.camera);
    const renderedAt = this.runtime.now();
    const displayMappingVersion = (
      this.sparkValue as unknown as InstrumentableSparkRenderer | undefined
    )?.display?.mappingVersion;
    if (
      this.activeFrame !== undefined &&
      displayMappingVersion !== undefined &&
      displayMappingVersion !== this.lastDisplayMappingVersion
    ) {
      if (this.lastDisplayCommitAt !== undefined) {
        this.displayCommitIntervalsMs.push(renderedAt - this.lastDisplayCommitAt);
      }
      this.lastDisplayCommitAt = renderedAt;
      this.lastDisplayMappingVersion = displayMappingVersion;
    }
    this.renderCallTimeMs = renderedAt - renderStartedAt;
    this.renderCallSamplesMs.push(this.renderCallTimeMs);
    this.renderRevision += 1;
    this.flushRenderTimingBatch(renderedAt);
  };

  private flushRenderTimingBatch(atMs: number): void {
    this.renderTimingBatchStartedAt ??= atMs;
    if (atMs - this.renderTimingBatchStartedAt < 500) {
      return;
    }
    const sample: SparkRenderTimingSample = {
      atMs,
      displayCommitIntervalsMs: this.displayCommitIntervalsMs.splice(0),
      flatFrameCopySamplesMs: this.flatFrameCopySamplesMs.splice(0),
      ...(this.activeFrame === undefined
        ? {}
        : { frameIndex: this.activeFrame.frameIndex }),
      renderCallSamplesMs: this.renderCallSamplesMs.splice(0),
      renderIntervalSamplesMs: this.renderIntervalSamplesMs.splice(0),
      sortOrderingUploadSamplesMs: this.sortOrderingUploadSamplesMs.splice(0),
      sortReadbackSamplesMs: this.sortReadbackSamplesMs.splice(0),
      sortSamplesMs: this.sortSamplesMs.splice(0),
      sortWorkerSamplesMs: this.sortWorkerSamplesMs.splice(0),
      sparkUpdateSamplesMs: this.sparkUpdateSamplesMs.splice(0),
    };
    this.renderTimingBatchStartedAt = atMs;
    this.options.onRenderTiming?.(sample);
  }

  private installRenderInstrumentation(spark: SparkRenderer): void {
    const instrumented = spark as unknown as InstrumentableSparkRenderer;
    if (typeof instrumented.updateInternal !== "function") {
      return;
    }

    spark.onSortTiming = (sample) => {
      this.sortTimeMs = sample.totalDurationMs;
      this.sortSamplesMs.push(sample.totalDurationMs);
      this.sortReadbackSamplesMs.push(sample.readbackDurationMs);
      this.sortWorkerSamplesMs.push(sample.workerSortDurationMs);
      this.sortOrderingUploadSamplesMs.push(sample.orderingUploadDurationMs);
    };

    const updateInternal = instrumented.updateInternal.bind(instrumented);
    instrumented.updateInternal = async (...args: unknown[]) => {
      const startedAt = this.runtime.now();
      try {
        return await updateInternal(...args);
      } finally {
        const durationMs = this.runtime.now() - startedAt;
        this.sparkUpdateTimeMs = durationMs;
        this.sparkUpdateSamplesMs.push(durationMs);
      }
    };
  }

  start(): void {
    this.assertInitialised();
    if (!this.startedAnimationLoop) {
      this.renderer.setAnimationLoop(this.render);
      this.startedAnimationLoop = true;
    }
  }

  stop(): void {
    if (this.startedAnimationLoop && this.rendererValue !== undefined) {
      this.rendererValue.setAnimationLoop(null);
      this.startedAnimationLoop = false;
    }
  }

  resize(): void {
    this.assertInitialised();
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    this.renderer.setPixelRatio(this.runtime.devicePixelRatio());
    this.renderer.setSize(width, height, false);

    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stop();
    this.resizeObserver?.disconnect();
    for (const objectId of [...this.loadedObjects.keys()]) {
      this.releaseObject(objectId);
    }
    for (const slot of this.frameSlots) {
      slot.release();
    }
    this.flatFrameDisplayValue?.dispose();
    this.flatFrameDisplayValue = undefined;
    this.frameSlots.clear();
    this.preparedFrames.clear();
    this.resourceMetrics.clear();
    this.sparkValue?.removeFromParent();
    this.sparkValue?.dispose();
    if (this.options.renderer === undefined) {
      this.rendererValue?.dispose();
    }
    this.sparkValue = undefined;
    this.rendererValue = undefined;
    this.sceneValue = undefined;
    this.cameraValue = undefined;
    this.disposed = true;
    this.initialised = false;
  }

  private createOrUseRenderer(): WebGLRenderer {
    if (this.options.renderer !== undefined) {
      if (
        this.options.canvas !== undefined &&
        this.options.renderer.domElement !== this.options.canvas
      ) {
        throw new SparkRendererStateError(
          "The supplied renderer does not render to the supplied canvas.",
        );
      }
      return this.options.renderer;
    }

    if (this.options.canvas === undefined) {
      throw new SparkRendererStateError(
        "A canvas or caller-owned Three.js renderer is required.",
      );
    }

    return this.runtime.createRenderer({
      alpha: true,
      antialias: false,
      canvas: this.options.canvas,
    });
  }

  private invalidateLod(): void {
    const spark = this.requireInitialised(this.sparkValue, "Spark renderer");
    spark.lodDirty = true;
    spark.setDirty();
  }

  private createProgressReporter(
    object: { id: string; url: string },
    callback?: RendererLoadProgressCallback,
    signal?: AbortSignal,
    resource?: MutableResourceMetrics,
  ): ((event: ProgressEvent) => void) | undefined {
    if (callback === undefined && resource === undefined) {
      return undefined;
    }

    return (event) => {
      if (signal?.aborted === true) {
        return;
      }
      const totalBytes = event.lengthComputable ? event.total : undefined;
      if (resource !== undefined) {
        resource.loadedBytes = event.loaded;
        if (totalBytes === undefined) {
          delete resource.totalBytes;
        } else {
          resource.totalBytes = totalBytes;
        }
      }
      callback?.({
        ...(totalBytes === undefined
          ? {}
          : {
              fraction: totalBytes === 0 ? 0 : event.loaded / totalBytes,
              totalBytes,
            }),
        loadedBytes: event.loaded,
        objectId: object.id,
        url: object.url,
      });
    };
  }

  private assertReadyForLoad(objectId: string, signal?: AbortSignal): void {
    this.assertInitialised();
    throwIfAborted(signal);
    if (this.loadedObjects.has(objectId) || this.loadingObjectIds.has(objectId)) {
      throw new SparkRendererStateError(
        `A renderer object with id "${objectId}" already exists.`,
      );
    }
  }

  private beginResource(
    id: string,
    kind: RendererObjectKind,
    url: string,
  ): MutableResourceMetrics {
    const resource: MutableResourceMetrics = {
      id,
      kind,
      state: "loading",
      url,
      visible: false,
    };
    this.resourceMetrics.set(id, resource);
    return resource;
  }

  private applyQualityConfiguration(): void {
    const spark = this.requireInitialised(this.sparkValue, "Spark renderer");
    const configuration = this.qualityConfiguration;
    spark.enableLod = configuration.enableLod;
    if (configuration.splatBudget === undefined) {
      delete spark.lodSplatCount;
    } else {
      spark.lodSplatCount = configuration.splatBudget;
    }
    spark.lodSplatScale = configuration.lodSplatScale;
    spark.lodRenderScale = configuration.lodRenderScale;
    spark.coneFov0 = configuration.foveation.fullDetailFovDegrees;
    spark.coneFov = configuration.foveation.peripheralDetailFovDegrees;
    spark.coneFoveate = configuration.foveation.peripheralScale;
    spark.behindFoveate = configuration.foveation.behindScale;

    for (const object of this.loadedObjects.values()) {
      if (object.splatMesh !== undefined) {
        this.applyQualityToStaticObject(object.id, object.splatMesh);
      }
    }
    for (const slot of this.frameSlots) {
      this.applyQualityToFrameSlot(slot);
    }
    this.flatFrameDisplayValue?.setMaximumSphericalHarmonics(
      configuration.maximumSphericalHarmonics,
    );
  }

  private applyQualityToStaticObject(objectId: string, mesh: SplatMesh): void {
    const configuration = this.qualityConfiguration;
    mesh.lodScale =
      configuration.staticSceneWeight * (configuration.objectWeights[objectId] ?? 1);
    this.applyMaximumSphericalHarmonics(mesh);
  }

  private applyQualityToFrameSlot(slot: SparkFrameSlot): void {
    const sequenceId = slot.snapshot.sequenceId;
    slot.setLodScale(
      sequenceId === undefined
        ? 1
        : (this.qualityConfiguration.dynamicSequenceWeights[sequenceId] ?? 1),
    );
    slot.setMaximumSphericalHarmonics(
      this.qualityConfiguration.maximumSphericalHarmonics,
    );
  }

  private applyMaximumSphericalHarmonics(mesh: SplatMesh): void {
    const maximum = this.qualityConfiguration.maximumSphericalHarmonics;
    if (mesh.maxSh !== maximum) {
      mesh.maxSh = maximum;
      mesh.updateGenerator();
    }
  }

  private normaliseWeight(weight: number): number {
    return Number.isFinite(weight) && weight > 0 ? weight : 0.001;
  }

  private normaliseWeights(
    weights: Readonly<Record<string, number>>,
  ): Record<string, number> {
    return Object.fromEntries(
      Object.entries(weights).map(([id, weight]) => [id, this.normaliseWeight(weight)]),
    );
  }

  private assertInitialised(): void {
    this.assertNotDisposed();
    if (!this.initialised) {
      throw new SparkRendererStateError("The Spark renderer is not initialised.");
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new SparkRendererStateError("The Spark renderer has been disposed.");
    }
  }

  private requireInitialised<T>(value: T | undefined, name: string): T {
    this.assertInitialised();
    if (value === undefined) {
      throw new SparkRendererStateError(`${name} is unavailable.`);
    }
    return value;
  }

  private requireLoadedObject(objectId: string): LoadedObjectRecord {
    this.assertInitialised();
    const object = this.loadedObjects.get(objectId);
    if (object === undefined) {
      throw new SparkRendererStateError(`Renderer object "${objectId}" is not loaded.`);
    }
    return object;
  }

  private requirePreparedFrame(frame: PreparedFrame): SparkFrameSlot {
    this.assertInitialised();
    const slot = this.preparedFrames.get(frame);
    if (slot === undefined || slot !== frame.rendererResource) {
      throw new SparkRendererStateError(
        "The prepared frame does not belong to this renderer.",
      );
    }
    return slot;
  }
}
