import "@babylonjs/loaders/SPLAT/index.js";
import "@babylonjs/loaders/glTF/index.js";

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { GaussianSplattingMesh } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience.js";

import { createDefaultBabylonFramePacker } from "./BabylonFramePackingPool.js";
import { applyBabylonTransform } from "./transform.js";

import type { BabylonFramePacker } from "./BabylonFramePackingPool.js";
import type { BabylonPackedFramePayload } from "./babylonPackedFrame.js";
import type { BabylonRendererAdapterOptions, BabylonRendererContext } from "./types.js";
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
  RendererMetrics,
  RendererObjectHandle,
  RendererObjectKind,
  RendererResourceMetrics,
  StaticSceneObject,
} from "@6g-path/gaussian-player";
import type { Transform } from "@6g-path/shared";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { WebXRDefaultExperienceOptions } from "@babylonjs/core/XR/webXRDefaultExperience.js";

interface BabylonPreparedResource {
  payload: BabylonPackedFramePayload;
  quality: FramePresentationQuality;
  transform?: Transform;
}

interface LoadedObjectRecord {
  kind: RendererObjectKind;
  meshes: AbstractMesh[];
  root: TransformNode;
}

interface MutableResourceMetric {
  id: string;
  kind: "dynamic-frame" | RendererObjectKind;
  loadedBytes?: number;
  state: "loading" | "ready";
  totalBytes?: number;
  url: string;
  visible: boolean;
}

export class BabylonGaussianRendererAdapter
  implements GaussianRendererAdapter, BabylonRendererContext
{
  private activeFrame: PreparedFrame | undefined;
  private readonly autoRender: boolean;
  private cameraValue:
    ArcRotateCamera | import("@babylonjs/core/Cameras/camera.js").Camera | undefined;
  private disposed = false;
  private dynamicMeshValue: GaussianSplattingMesh | undefined;
  private dynamicGpuReallocationCount = 0;
  private engineValue: Engine | undefined;
  private failedResourceLoadCount = 0;
  private frameCommitTimeMs: number | undefined;
  private framePackerValue: BabylonFramePacker | undefined;
  private frameTimeMs: number | undefined;
  private initialised = false;
  private lastRenderAt: number | undefined;
  private readonly loadedObjects = new Map<string, LoadedObjectRecord>();
  private readonly manageResize: boolean;
  private maximumSplatCapacity = 0;
  private readonly now: () => number;
  private readonly options: BabylonRendererAdapterOptions;
  private readonly preparedFrames = new Map<PreparedFrame, BabylonPreparedResource>();
  private renderCallTimeMs: number | undefined;
  private renderFramesPerSecond: number | undefined;
  private presentationQueue: Promise<void> = Promise.resolve();
  private resizeObserver: ResizeObserver | undefined;
  private readonly resourceMetrics = new Map<string, MutableResourceMetric>();
  private sceneValue: Scene | undefined;
  private startedRenderLoop = false;

  constructor(options: BabylonRendererAdapterOptions) {
    this.options = options;
    this.autoRender = options.autoRender ?? options.engine === undefined;
    this.manageResize = options.manageResize ?? options.engine === undefined;
    this.now = options.now ?? (() => performance.now());
  }

  get camera() {
    return this.requireInitialised(this.cameraValue, "camera");
  }

  get engine(): Engine {
    return this.requireInitialised(this.engineValue, "engine");
  }

  get orbitCamera(): ArcRotateCamera | undefined {
    return this.cameraValue instanceof ArcRotateCamera ? this.cameraValue : undefined;
  }

  get scene(): Scene {
    return this.requireInitialised(this.sceneValue, "scene");
  }

  async initialise(): Promise<void> {
    this.assertNotDisposed();
    if (this.initialised) {
      return;
    }
    const canvas = this.options.canvas;
    if (this.options.engine === undefined && canvas === undefined) {
      throw new Error(
        "A canvas is required when the Babylon adapter creates its engine.",
      );
    }

    const engine = this.options.engine ?? new Engine(canvas!, true);
    try {
      const scene = this.options.scene ?? new Scene(engine);
      scene.useRightHandedSystem = true;
      const camera =
        this.options.camera ??
        new ArcRotateCamera(
          "gaussian-player-camera",
          -Math.PI / 2,
          Math.PI / 2,
          3,
          Vector3.Zero(),
          scene,
        );
      if (
        this.options.camera === undefined &&
        canvas !== undefined &&
        camera instanceof ArcRotateCamera
      ) {
        camera.attachControl(canvas, true);
        camera.minZ = 0.01;
        camera.wheelDeltaPercentage = 0.01;
      }
      scene.activeCamera = camera;
      if (this.options.scene === undefined) {
        new HemisphericLight("gaussian-player-light", new Vector3(0, 1, 0), scene);
      }
      const dynamicMesh = new GaussianSplattingMesh(
        "gaussian-player-dynamic",
        null,
        scene,
        false,
      );
      dynamicMesh.setEnabled(false);

      this.engineValue = engine;
      this.sceneValue = scene;
      this.cameraValue = camera;
      this.dynamicMeshValue = dynamicMesh;
      this.framePackerValue =
        this.options.framePacker ??
        createDefaultBabylonFramePacker(
          this.options.maximumPackingWorkers ?? 2,
          this.now,
        );
      this.initialised = true;

      if (this.manageResize && canvas !== undefined) {
        const resize = () => engine.resize();
        if (typeof globalThis.ResizeObserver === "function") {
          this.resizeObserver = new ResizeObserver(resize);
          this.resizeObserver.observe(canvas);
        }
        resize();
      }
      if (this.autoRender) {
        this.start();
      }
    } catch (error) {
      if (this.options.engine === undefined) {
        engine.dispose();
      }
      throw error;
    }
  }

  /** Creates Babylon's standard WebXR experience and entry UI for this scene. */
  async createDefaultXrExperience(
    options: WebXRDefaultExperienceOptions = {},
  ): Promise<WebXRDefaultExperience> {
    this.assertInitialised();
    return WebXRDefaultExperience.CreateAsync(this.scene, options);
  }

  start(): void {
    this.assertInitialised();
    if (this.startedRenderLoop) {
      return;
    }
    this.startedRenderLoop = true;
    this.engine.runRenderLoop(() => this.render());
  }

  render(): void {
    this.assertInitialised();
    const startedAt = this.now();
    this.scene.render();
    const completedAt = this.now();
    this.renderCallTimeMs = completedAt - startedAt;
    if (this.lastRenderAt !== undefined) {
      this.frameTimeMs = completedAt - this.lastRenderAt;
      if (this.frameTimeMs > 0) {
        this.renderFramesPerSecond = 1_000 / this.frameTimeMs;
      }
    }
    this.lastRenderAt = completedAt;
  }

  async loadStaticObject(
    object: StaticSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    if (/\.rad(?:$|[?#])/i.test(object.url)) {
      throw new Error("The Babylon adapter does not support Spark RAD static assets.");
    }
    return this.loadObject(object, "static-splat", options);
  }

  async loadMesh(
    object: MeshSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    return this.loadObject(object, "mesh", options);
  }

  async prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame> {
    this.assertInitialised();
    throwIfAborted(options.signal);
    if (options.decodedFrame === undefined) {
      throw new Error("The Babylon adapter requires a renderer-neutral decoded frame.");
    }
    const startedAt = this.now();
    options.onTrace?.({ elapsedMs: 0, phase: "resource-created" });
    const packing = await this.requireFramePacker().pack(
      options.decodedFrame,
      options.signal,
    );
    throwIfAborted(options.signal);
    const quality: FramePresentationQuality = {
      achievedDetailLevel: options.transferQuality?.detailLevel ?? 1,
      detailLevel:
        options.targetQualityLevel ?? options.transferQuality?.detailLevel ?? 1,
      maximumSplatCount: packing.payload.numSplats,
      requestedDetailLevel:
        options.targetQualityLevel ?? options.transferQuality?.detailLevel ?? 1,
      selectedSplatCount: packing.payload.numSplats,
      state: "presentable",
    };
    const elapsedMs = this.now() - startedAt;
    for (const [phase, stageDurationMs] of [
      ["flat-pack-queue", packing.queueDurationMs],
      ["flat-pack-worker", packing.workerDurationMs],
      ["flat-pack-transfer", packing.resultTransferDurationMs],
      ["flat-pack", packing.totalDurationMs],
    ] as const) {
      options.onTrace?.({ elapsedMs, phase, stageDurationMs });
    }
    options.onTrace?.({ elapsedMs, phase: "minimum-renderable", quality });

    const prepared: PreparedFrame = {
      frameIndex: frame.frameIndex,
      sequenceId,
      source: frame,
      qualityLevel: options.transferQuality?.level ?? 0,
      ...(options.transferQuality === undefined
        ? {}
        : { transferQuality: options.transferQuality }),
      rendererResource: packing.payload,
    };
    this.preparedFrames.set(prepared, {
      payload: packing.payload,
      quality,
      ...(options.transform === undefined ? {} : { transform: options.transform }),
    });
    this.resourceMetrics.set(this.frameResourceId(prepared), {
      id: this.frameResourceId(prepared),
      kind: "dynamic-frame",
      ...(options.compressedBytes === undefined
        ? {}
        : { loadedBytes: options.compressedBytes.byteLength }),
      state: "ready",
      ...(options.compressedBytes === undefined
        ? {}
        : { totalBytes: options.compressedBytes.byteLength }),
      url: frame.url,
      visible: false,
    });
    return prepared;
  }

  async presentFrame(frame: PreparedFrame): Promise<void> {
    this.assertInitialised();
    const resource = this.requirePreparedFrame(frame);
    const presentation = this.presentationQueue.then(() =>
      this.commitPreparedFrame(frame, resource),
    );
    this.presentationQueue = presentation.catch(() => undefined);
    await presentation;
  }

  hideFrame(frame: PreparedFrame): void {
    if (this.activeFrame === frame) {
      this.requireDynamicMesh().setEnabled(false);
      this.activeFrame = undefined;
    }
    const metric = this.resourceMetrics.get(this.frameResourceId(frame));
    if (metric !== undefined) {
      metric.visible = false;
    }
  }

  releaseFrame(frame: PreparedFrame): void {
    if (this.activeFrame === frame) {
      this.hideFrame(frame);
    }
    this.preparedFrames.delete(frame);
    this.resourceMetrics.delete(this.frameResourceId(frame));
  }

  async refineFrame(
    frame: PreparedFrame,
    _target: FrameQualityTarget,
    options: FrameRefinementOptions = {},
  ): Promise<FramePresentationQuality> {
    throwIfAborted(options.signal);
    const quality = this.requirePreparedFrame(frame).quality;
    options.onProgress?.(quality);
    return quality;
  }

  getFramePresentationQuality(frame: PreparedFrame): FramePresentationQuality {
    return this.requirePreparedFrame(frame).quality;
  }

  setFrameRefinement(frame: PreparedFrame, enabled: boolean): void {
    void frame;
    void enabled;
  }

  setFrameTransform(frame: PreparedFrame, transform?: Transform): void {
    const resource = this.requirePreparedFrame(frame);
    if (transform === undefined) {
      delete resource.transform;
    } else {
      resource.transform = transform;
    }
    if (this.activeFrame === frame) {
      applyBabylonTransform(this.requireDynamicMesh(), transform);
    }
  }

  setObjectTransform(objectId: string, transform: Transform): void {
    applyBabylonTransform(this.requireObject(objectId).root, transform);
  }

  setObjectVisibility(objectId: string, visible: boolean): void {
    this.requireObject(objectId).root.setEnabled(visible);
    const metric = this.resourceMetrics.get(objectId);
    if (metric !== undefined) {
      metric.visible = visible;
    }
  }

  releaseObject(objectId: string): void {
    const record = this.loadedObjects.get(objectId);
    if (record === undefined) {
      return;
    }
    record.root.dispose(false, true);
    this.loadedObjects.delete(objectId);
    this.resourceMetrics.delete(objectId);
  }

  setRenderQuality(decision: QualityDecision): void {
    void decision;
  }

  getMetrics(): RendererMetrics {
    const activeResource =
      this.activeFrame === undefined
        ? undefined
        : this.preparedFrames.get(this.activeFrame);
    return {
      ...(this.activeFrame === undefined
        ? {}
        : { activeFrameIndex: this.activeFrame.frameIndex }),
      dynamicGpuCapacity: this.maximumSplatCapacity,
      dynamicGpuReallocationCount: this.dynamicGpuReallocationCount,
      failedResourceLoadCount: this.failedResourceLoadCount,
      ...(this.frameCommitTimeMs === undefined
        ? {}
        : { frameCommitTimeMs: this.frameCommitTimeMs }),
      ...(this.frameTimeMs === undefined ? {} : { frameTimeMs: this.frameTimeMs }),
      loadedMeshObjectCount: [...this.loadedObjects.values()].filter(
        ({ kind }) => kind === "mesh",
      ).length,
      loadedStaticObjectCount: [...this.loadedObjects.values()].filter(
        ({ kind }) => kind === "static-splat",
      ).length,
      loadingResourceCount: [...this.resourceMetrics.values()].filter(
        ({ state }) => state === "loading",
      ).length,
      preparedFrameCount: this.preparedFrames.size,
      ...(this.renderCallTimeMs === undefined
        ? {}
        : { renderCallTimeMs: this.renderCallTimeMs }),
      ...(activeResource === undefined
        ? {}
        : { renderedSplatCount: activeResource.payload.numSplats }),
      ...(this.renderFramesPerSecond === undefined
        ? {}
        : { renderFramesPerSecond: this.renderFramesPerSecond }),
      resources: [...this.resourceMetrics.values()].map(
        (resource): RendererResourceMetrics => ({ ...resource }),
      ),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (this.startedRenderLoop) {
      this.engineValue?.stopRenderLoop();
    }
    for (const objectId of [...this.loadedObjects.keys()]) {
      this.releaseObject(objectId);
    }
    this.dynamicMeshValue?.dispose(false);
    if (this.options.framePacker === undefined) {
      this.framePackerValue?.dispose?.();
    }
    if (this.options.scene === undefined) {
      this.sceneValue?.dispose();
    }
    if (this.options.engine === undefined) {
      this.engineValue?.dispose();
    }
    this.preparedFrames.clear();
    this.resourceMetrics.clear();
  }

  private async loadObject(
    object: StaticSceneObject | MeshSceneObject,
    kind: RendererObjectKind,
    options: RendererLoadOptions,
  ): Promise<RendererObjectHandle> {
    this.assertInitialised();
    throwIfAborted(options.signal);
    if (this.loadedObjects.has(object.id) || this.resourceMetrics.has(object.id)) {
      throw new Error(`Renderer object '${object.id}' already exists.`);
    }
    const metric: MutableResourceMetric = {
      id: object.id,
      kind,
      state: "loading",
      url: object.url,
      visible: false,
    };
    this.resourceMetrics.set(object.id, metric);
    let importedMeshes: AbstractMesh[] | undefined;
    try {
      const result = await ImportMeshAsync(object.url, this.scene, {
        onProgress: (event) => {
          throwIfAborted(options.signal);
          metric.loadedBytes = event.loaded;
          if (event.lengthComputable) {
            metric.totalBytes = event.total;
          }
          options.onProgress?.({
            ...(event.lengthComputable && event.total > 0
              ? { fraction: event.loaded / event.total, totalBytes: event.total }
              : {}),
            loadedBytes: event.loaded,
            objectId: object.id,
            url: object.url,
          });
        },
      });
      importedMeshes = result.meshes;
      throwIfAborted(options.signal);
      const root = new TransformNode(`${object.id}-root`, this.scene);
      for (const mesh of result.meshes) {
        if (mesh.parent === null) {
          mesh.parent = root;
        }
      }
      applyBabylonTransform(root, object.transform);
      metric.state = "ready";
      metric.visible = true;
      this.loadedObjects.set(object.id, { kind, meshes: result.meshes, root });
      return Object.freeze({ id: object.id, kind });
    } catch (error) {
      for (const mesh of importedMeshes ?? []) {
        mesh.dispose(false, true);
      }
      this.failedResourceLoadCount += 1;
      this.resourceMetrics.delete(object.id);
      throw error;
    }
  }

  private assertInitialised(): void {
    this.assertNotDisposed();
    if (!this.initialised) {
      throw new Error("The Babylon renderer adapter has not been initialised.");
    }
  }

  private async commitPreparedFrame(
    frame: PreparedFrame,
    resource: BabylonPreparedResource,
  ): Promise<void> {
    this.assertInitialised();
    const startedAt = this.now();
    const mesh = this.requireDynamicMesh();
    applyBabylonTransform(mesh, resource.transform);
    await mesh.updateDataAsync(
      resource.payload.splatBuffer,
      resource.payload.sphericalHarmonics.length === 0
        ? undefined
        : resource.payload.sphericalHarmonics,
      undefined,
      resource.payload.shDegree,
    );
    this.assertInitialised();
    mesh.setEnabled(true);
    this.frameCommitTimeMs = this.now() - startedAt;
    const textureWidth = Math.max(1, this.engine.getCaps().maxTextureSize);
    const requiredCapacity =
      textureWidth * Math.max(1, Math.ceil(resource.payload.numSplats / textureWidth));
    if (requiredCapacity > this.maximumSplatCapacity) {
      this.maximumSplatCapacity = requiredCapacity;
      this.dynamicGpuReallocationCount += 1;
    }
    if (this.activeFrame !== undefined) {
      const previousMetric = this.resourceMetrics.get(
        this.frameResourceId(this.activeFrame),
      );
      if (previousMetric !== undefined) {
        previousMetric.visible = false;
      }
    }
    this.activeFrame = frame;
    const metric = this.resourceMetrics.get(this.frameResourceId(frame));
    if (metric !== undefined) {
      metric.visible = true;
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("The Babylon renderer adapter was disposed.");
    }
  }

  private frameResourceId(frame: PreparedFrame): string {
    return `${frame.sequenceId}:frame:${frame.frameIndex}`;
  }

  private requireDynamicMesh(): GaussianSplattingMesh {
    return this.requireInitialised(this.dynamicMeshValue, "dynamic mesh");
  }

  private requireFramePacker(): BabylonFramePacker {
    return this.requireInitialised(this.framePackerValue, "frame packer");
  }

  private requireInitialised<T>(value: T | undefined, name: string): T {
    this.assertInitialised();
    if (value === undefined) {
      throw new Error(`The Babylon renderer ${name} is unavailable.`);
    }
    return value;
  }

  private requireObject(objectId: string): LoadedObjectRecord {
    const object = this.loadedObjects.get(objectId);
    if (object === undefined) {
      throw new Error(`Renderer object '${objectId}' is not loaded.`);
    }
    return object;
  }

  private requirePreparedFrame(frame: PreparedFrame): BabylonPreparedResource {
    const resource = this.preparedFrames.get(frame);
    if (resource === undefined) {
      throw new Error("The prepared Babylon frame is no longer owned by this adapter.");
    }
    return resource;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Babylon renderer operation was aborted.", "AbortError");
  }
}
