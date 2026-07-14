import { PerspectiveCamera } from "three";

import { throwIfAborted, waitWithAbort } from "./abort.js";
import { disposeObject } from "./disposeObject.js";
import { SparkRendererStateError } from "./errors.js";
import { defaultSparkRendererRuntime } from "./runtime.js";
import { applyTransform } from "./transform.js";

import type { ResizeObserverLike, SparkRendererRuntime } from "./runtime.js";
import type { SparkRendererAdapterOptions } from "./types.js";
import type {
  FramePreparationOptions,
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
  StaticSceneObject,
} from "@6g-path/gaussian-player";
import type { Transform } from "@6g-path/shared";
import type { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { Camera, Object3D, Scene, WebGLRenderer } from "three";

interface LoadedObjectRecord {
  dispose(): void;
  kind: RendererObjectKind;
  node: Object3D;
}

export class SparkGaussianRendererAdapter implements GaussianRendererAdapter {
  private readonly autoRender: boolean;
  private readonly loadedObjects = new Map<string, LoadedObjectRecord>();
  private readonly loadingObjectIds = new Set<string>();
  private readonly manageResize: boolean;
  private readonly options: SparkRendererAdapterOptions;
  private readonly preparedFrames = new Map<PreparedFrame, SplatMesh>();
  private readonly runtime: SparkRendererRuntime;
  private activeFrame: PreparedFrame | undefined;
  private cameraValue: Camera | undefined;
  private disposed = false;
  private frameTimeMs: number | undefined;
  private initialised = false;
  private lastRenderTime: number | undefined;
  private rendererValue: WebGLRenderer | undefined;
  private renderFramesPerSecond: number | undefined;
  private resizeObserver: ResizeObserverLike | undefined;
  private sceneValue: Scene | undefined;
  private sparkValue: SparkRenderer | undefined;
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

      scene.add(spark);
      this.rendererValue = renderer;
      this.sceneValue = scene;
      this.cameraValue = camera;
      this.sparkValue = spark;
      this.initialised = true;

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
    let splatMesh: SplatMesh | undefined;

    try {
      const onProgress = this.createProgressReporter(
        object,
        options.onProgress,
        options.signal,
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
      const loadedSplatMesh = splatMesh;
      this.loadedObjects.set(object.id, {
        dispose: () => loadedSplatMesh.dispose(),
        kind: "static-splat",
        node: loadedSplatMesh,
      });
      splatMesh = undefined;
      return Object.freeze({ id: object.id, kind: "static-splat" });
    } catch (error) {
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
    let meshRoot: Object3D | undefined;

    try {
      const load = this.runtime
        .createGltfLoader()
        .loadAsync(
          object.url,
          this.createProgressReporter(object, options.onProgress, options.signal),
        );
      const gltf = await waitWithAbort(load, options.signal, (abortedGltf) =>
        disposeObject(abortedGltf.scene),
      );
      this.assertNotDisposed();
      meshRoot = gltf.scene;
      applyTransform(meshRoot, object.transform);
      this.scene.add(meshRoot);
      const loadedMeshRoot = meshRoot;
      this.loadedObjects.set(object.id, {
        dispose: () => disposeObject(loadedMeshRoot),
        kind: "mesh",
        node: loadedMeshRoot,
      });
      meshRoot = undefined;
      return Object.freeze({ id: object.id, kind: "mesh" });
    } catch (error) {
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
    const onProgress = this.createProgressReporter(
      { id: `${sequenceId}:${frame.frameIndex}`, url: frame.url },
      options.onProgress,
      options.signal,
    );
    let splatMesh: SplatMesh | undefined = this.runtime.createSplatMesh({
      editable: false,
      ...(onProgress === undefined ? {} : { onProgress }),
      paged: true,
      url: frame.url,
    });

    try {
      await waitWithAbort(splatMesh.initialized, options.signal, () => undefined);
      this.assertNotDisposed();
      splatMesh.visible = false;
      this.scene.add(splatMesh);
      const preparedFrame: PreparedFrame = {
        frameIndex: frame.frameIndex,
        qualityLevel: options.targetQualityLevel ?? 0,
        rendererResource: splatMesh,
        sequenceId,
        source: frame,
      };
      this.preparedFrames.set(preparedFrame, splatMesh);
      splatMesh = undefined;
      return preparedFrame;
    } catch (error) {
      splatMesh?.removeFromParent();
      splatMesh?.dispose();
      throw error;
    }
  }

  presentFrame(frame: PreparedFrame): void {
    const mesh = this.requirePreparedFrame(frame);
    if (this.activeFrame !== undefined && this.activeFrame !== frame) {
      this.requirePreparedFrame(this.activeFrame).visible = false;
    }
    mesh.visible = true;
    this.activeFrame = frame;
  }

  hideFrame(frame: PreparedFrame): void {
    this.requirePreparedFrame(frame).visible = false;
    if (this.activeFrame === frame) {
      this.activeFrame = undefined;
    }
  }

  releaseFrame(frame: PreparedFrame): void {
    const mesh = this.requirePreparedFrame(frame);
    this.preparedFrames.delete(frame);
    mesh.removeFromParent();
    mesh.dispose();
    if (this.activeFrame === frame) {
      this.activeFrame = undefined;
    }
  }

  setObjectTransform(objectId: string, transform: Transform): void {
    applyTransform(this.requireLoadedObject(objectId).node, transform);
  }

  setObjectVisibility(objectId: string, visible: boolean): void {
    this.requireLoadedObject(objectId).node.visible = visible;
  }

  releaseObject(objectId: string): void {
    const object = this.requireLoadedObject(objectId);
    this.loadedObjects.delete(objectId);
    object.node.removeFromParent();
    object.dispose();
  }

  setRenderQuality(decision: QualityDecision): void {
    const spark = this.requireInitialised(this.sparkValue, "Spark renderer");
    spark.lodSplatCount = Math.max(1, Math.floor(decision.renderSplatBudget));
  }

  getMetrics(): RendererMetrics {
    const objects = [...this.loadedObjects.values()];
    const spark = this.sparkValue;
    return {
      ...(this.activeFrame === undefined
        ? {}
        : { activeFrameIndex: this.activeFrame.frameIndex }),
      ...(this.frameTimeMs === undefined ? {} : { frameTimeMs: this.frameTimeMs }),
      loadedMeshObjectCount: objects.filter(({ kind }) => kind === "mesh").length,
      loadedStaticObjectCount: objects.filter(({ kind }) => kind === "static-splat")
        .length,
      ...(spark === undefined ? {} : { renderedSplatCount: spark.activeSplats }),
      ...(this.renderFramesPerSecond === undefined
        ? {}
        : { renderFramesPerSecond: this.renderFramesPerSecond }),
    };
  }

  render = (): void => {
    this.assertInitialised();
    const now = this.runtime.now();
    if (this.lastRenderTime !== undefined) {
      this.frameTimeMs = now - this.lastRenderTime;
      this.renderFramesPerSecond =
        this.frameTimeMs > 0 ? 1000 / this.frameTimeMs : undefined;
    }
    this.lastRenderTime = now;
    this.renderer.render(this.scene, this.camera);
  };

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
    for (const frame of [...this.preparedFrames.keys()]) {
      this.releaseFrame(frame);
    }
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

  private createProgressReporter(
    object: { id: string; url: string },
    callback?: RendererLoadProgressCallback,
    signal?: AbortSignal,
  ): ((event: ProgressEvent) => void) | undefined {
    if (callback === undefined) {
      return undefined;
    }

    return (event) => {
      if (signal?.aborted === true) {
        return;
      }
      const totalBytes = event.lengthComputable ? event.total : undefined;
      callback({
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

  private requirePreparedFrame(frame: PreparedFrame): SplatMesh {
    this.assertInitialised();
    const mesh = this.preparedFrames.get(frame);
    if (mesh === undefined || mesh !== frame.rendererResource) {
      throw new SparkRendererStateError(
        "The prepared frame does not belong to this renderer.",
      );
    }
    return mesh;
  }
}
