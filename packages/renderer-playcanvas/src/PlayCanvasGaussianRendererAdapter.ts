import {
  Application,
  Asset,
  Color,
  Entity,
  FILLMODE_NONE,
  RESOLUTION_AUTO,
  XRSPACE_LOCALFLOOR,
  XRTYPE_VR,
} from "playcanvas";

import { applyPlayCanvasTransform } from "./transform.js";

import type {
  PlayCanvasRendererAdapterOptions,
  PlayCanvasRendererContext,
  PlayCanvasXrStartOptions,
} from "./types.js";
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
import type { ContainerResource, GSplatResourceBase } from "playcanvas";

export const PLAYCANVAS_SOG_CODEC_ID = "sog-v2";

interface PlayCanvasPreparedResource {
  asset: Asset;
  numSplats: number;
  presentationUseCount: number;
  quality: FramePresentationQuality;
  releaseFinalisationScheduled: boolean;
  releaseRequested: boolean;
  transform?: Transform;
}

interface LoadedObjectRecord {
  asset: Asset;
  entity: Entity;
  kind: RendererObjectKind;
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

export class PlayCanvasGaussianRendererAdapter
  implements GaussianRendererAdapter, PlayCanvasRendererContext
{
  private activeFrame: PreparedFrame | undefined;
  private applicationValue: Application | undefined;
  private boundFrame: PreparedFrame | undefined;
  private cameraEntityValue: Entity | undefined;
  private disposed = false;
  private dynamicEntityValue: Entity | undefined;
  private failedResourceLoadCount = 0;
  private frameCommitTimeMs: number | undefined;
  private initialised = false;
  private readonly loadedObjects = new Map<string, LoadedObjectRecord>();
  private readonly now: () => number;
  private readonly options: PlayCanvasRendererAdapterOptions;
  private orbitControlsCleanup: (() => void) | undefined;
  private readonly pendingLoadCancellations = new Set<(error: Error) => void>();
  private readonly pendingPresentationCancellations = new Set<(error: Error) => void>();
  private readonly preparedFrames = new Map<
    PreparedFrame,
    PlayCanvasPreparedResource
  >();
  private presentationQueue: Promise<void> = Promise.resolve();
  private readonly resourceMetrics = new Map<string, MutableResourceMetric>();

  constructor(options: PlayCanvasRendererAdapterOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  get application(): Application {
    return this.requireInitialised(this.applicationValue, "application");
  }

  get cameraEntity(): Entity {
    return this.requireInitialised(this.cameraEntityValue, "camera entity");
  }

  get dynamicEntity(): Entity {
    return this.requireInitialised(this.dynamicEntityValue, "dynamic entity");
  }

  async initialise(): Promise<void> {
    this.assertNotDisposed();
    if (this.initialised) {
      return;
    }
    if (this.options.application === undefined && this.options.canvas === undefined) {
      throw new Error(
        "A canvas is required when the PlayCanvas adapter creates its application.",
      );
    }

    const ownsApplication = this.options.application === undefined;
    const application =
      this.options.application ??
      new Application(this.options.canvas!, {
        graphicsDeviceOptions: { antialias: false },
      });
    try {
      const clearColor = new Color(0.07, 0.07, 0.1, 1);
      if (
        (this.options.manageResize ?? ownsApplication) &&
        this.options.canvas !== undefined
      ) {
        application.setCanvasFillMode(FILLMODE_NONE);
        application.setCanvasResolution(RESOLUTION_AUTO);
      }

      const cameraEntity =
        this.options.cameraEntity ?? new Entity("gaussian-player-camera", application);
      if (this.options.cameraEntity === undefined) {
        cameraEntity.addComponent("camera", { clearColor });
        cameraEntity.setPosition(0, 0, 3);
        cameraEntity.lookAt(0, 0, 0);
        application.root.addChild(cameraEntity);
      } else if (cameraEntity.camera === undefined) {
        throw new Error(
          "The caller-owned PlayCanvas camera entity has no camera component.",
        );
      }

      const dynamicEntity = new Entity("gaussian-player-dynamic", application);
      dynamicEntity.addComponent("gsplat", { unified: true });
      // hide()/show() only affect PlayCanvas's legacy GSplat instance. Unified
      // placements are attached to layers through the component enabled state.
      dynamicEntity.gsplat!.enabled = false;
      application.root.addChild(dynamicEntity);

      this.applicationValue = application;
      this.cameraEntityValue = cameraEntity;
      this.dynamicEntityValue = dynamicEntity;
      this.initialised = true;

      if (
        this.options.cameraEntity === undefined &&
        this.options.canvas !== undefined
      ) {
        this.orbitControlsCleanup = installOrbitControls(
          this.options.canvas,
          cameraEntity,
          application,
        );
      }

      if (this.options.autoRender ?? ownsApplication) {
        application.start();
      }
    } catch (error) {
      this.orbitControlsCleanup?.();
      this.orbitControlsCleanup = undefined;
      if (ownsApplication) {
        application.destroy();
      }
      throw error;
    }
  }

  canPrepareCompressedFrame(codecId: string): boolean {
    return codecId === PLAYCANVAS_SOG_CODEC_ID;
  }

  isXrAvailable(): boolean {
    return (
      this.initialised && (this.applicationValue?.xr?.isAvailable(XRTYPE_VR) ?? false)
    );
  }

  isXrActive(): boolean {
    return this.initialised && (this.applicationValue?.xr?.active ?? false);
  }

  async startXr(options: PlayCanvasXrStartOptions = {}): Promise<void> {
    this.assertInitialised();
    if (this.isXrActive()) {
      return;
    }
    if (!this.isXrAvailable()) {
      throw new Error("Immersive VR is not available in this browser.");
    }
    await new Promise<void>((resolve, reject) => {
      this.cameraEntity.camera!.startXr(XRTYPE_VR, XRSPACE_LOCALFLOOR, {
        optionalFeatures: options.optionalFeatures ?? [],
        callback: (error) => {
          if (error !== null) {
            reject(error);
          } else {
            resolve();
          }
        },
      });
    });
  }

  async endXr(): Promise<void> {
    this.assertInitialised();
    if (!this.isXrActive()) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.cameraEntity.camera!.endXr((error) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async loadStaticObject(
    object: StaticSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    if (/\.rad(?:$|[?#])/i.test(object.url)) {
      throw new Error(
        "The PlayCanvas adapter does not support Spark RAD static assets.",
      );
    }
    return this.loadObject(object, "static-splat", "gsplat", options);
  }

  async loadMesh(
    object: MeshSceneObject,
    options: RendererLoadOptions = {},
  ): Promise<RendererObjectHandle> {
    return this.loadObject(object, "mesh", "container", options);
  }

  async prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame> {
    this.assertInitialised();
    throwIfAborted(options.signal);
    const codecId = frame.codec ?? options.transferQuality?.codec;
    if (codecId === undefined || !this.canPrepareCompressedFrame(codecId)) {
      throw new Error(
        `The PlayCanvas adapter requires '${PLAYCANVAS_SOG_CODEC_ID}' compressed frames.`,
      );
    }
    if (!/\.sog(?:$|[?#])/iu.test(frame.url)) {
      throw new Error(
        `The PlayCanvas adapter requires a .sog frame URL for '${PLAYCANVAS_SOG_CODEC_ID}'.`,
      );
    }
    if (options.compressedBytes === undefined) {
      throw new Error("The PlayCanvas adapter requires complete compressed SOG bytes.");
    }

    const startedAt = this.now();
    options.onTrace?.({ elapsedMs: 0, phase: "resource-created" });
    const byteLength = options.compressedBytes.byteLength;
    const asset = this.createSogAsset(
      `${sequenceId}-${frame.frameIndex}-${options.transferQuality?.level ?? 0}`,
      frame.url,
      options.compressedBytes,
    );
    const resourceId = `${sequenceId}:${frame.frameIndex}:${options.transferQuality?.level ?? 0}`;
    const metric: MutableResourceMetric = {
      id: resourceId,
      kind: "dynamic-frame",
      loadedBytes: byteLength,
      state: "loading",
      totalBytes: byteLength,
      url: frame.url,
      visible: false,
    };
    this.resourceMetrics.set(resourceId, metric);
    try {
      await this.loadAsset(asset, options.signal);
      this.assertInitialised();
      throwIfAborted(options.signal);
      releaseSourceContents(asset);
      const numSplats = readSplatCount(asset);
      const detailLevel = options.transferQuality?.detailLevel ?? 1;
      const quality: FramePresentationQuality = {
        achievedDetailLevel: detailLevel,
        detailLevel: options.targetQualityLevel ?? detailLevel,
        maximumSplatCount: numSplats,
        requestedDetailLevel: options.targetQualityLevel ?? detailLevel,
        selectedSplatCount: numSplats,
        state: "presentable",
      };
      const elapsedMs = this.now() - startedAt;
      options.onTrace?.({ elapsedMs, phase: "gpu-upload", stageDurationMs: elapsedMs });
      options.onTrace?.({ elapsedMs, phase: "minimum-renderable", quality });
      options.onProgress?.({
        fraction: 1,
        loadedBytes: byteLength,
        objectId: resourceId,
        totalBytes: byteLength,
        url: frame.url,
      });

      const prepared: PreparedFrame = {
        frameIndex: frame.frameIndex,
        sequenceId,
        source: frame,
        qualityLevel: options.transferQuality?.level ?? 0,
        ...(options.transferQuality === undefined
          ? {}
          : { transferQuality: options.transferQuality }),
        rendererResource: asset,
      };
      this.preparedFrames.set(prepared, {
        asset,
        numSplats,
        presentationUseCount: 0,
        quality,
        releaseFinalisationScheduled: false,
        releaseRequested: false,
        ...(options.transform === undefined ? {} : { transform: options.transform }),
      });
      metric.state = "ready";
      return prepared;
    } catch (error) {
      this.failedResourceLoadCount += 1;
      this.resourceMetrics.delete(resourceId);
      this.unloadAsset(asset);
      throw error;
    }
  }

  async presentFrame(frame: PreparedFrame): Promise<void> {
    this.assertInitialised();
    const resource = this.requirePreparedFrame(frame);
    resource.presentationUseCount += 1;
    const presentation = this.presentationQueue.then(() =>
      this.commitPreparedFrame(frame, resource),
    );
    this.presentationQueue = presentation.catch(() => undefined);
    try {
      await presentation;
    } finally {
      resource.presentationUseCount -= 1;
      if (resource.releaseRequested && resource.presentationUseCount === 0) {
        this.finaliseFrameRelease(frame, resource);
      }
    }
  }

  hideFrame(frame: PreparedFrame): void {
    if (this.activeFrame === frame) {
      this.dynamicEntity.gsplat!.enabled = false;
      this.activeFrame = undefined;
      this.application.renderNextFrame = true;
    }
    const metric = this.resourceMetrics.get(this.frameResourceId(frame));
    if (metric !== undefined) {
      metric.visible = false;
    }
  }

  releaseFrame(frame: PreparedFrame): void {
    const resource = this.preparedFrames.get(frame);
    if (resource === undefined) {
      return;
    }
    resource.releaseRequested = true;
    if (this.boundFrame === frame) {
      this.hideFrame(frame);
      this.dynamicEntity.gsplat!.enabled = false;
      this.application.renderNextFrame = true;
    }
    this.resourceMetrics.delete(this.frameResourceId(frame));
    if (resource.presentationUseCount === 0) {
      this.finaliseFrameRelease(frame, resource);
    }
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
      applyPlayCanvasTransform(this.dynamicEntity, transform);
      this.application.renderNextFrame = true;
    }
  }

  setObjectTransform(objectId: string, transform: Transform): void {
    applyPlayCanvasTransform(this.requireObject(objectId).entity, transform);
    this.application.renderNextFrame = true;
  }

  setObjectVisibility(objectId: string, visible: boolean): void {
    this.requireObject(objectId).entity.enabled = visible;
    const metric = this.resourceMetrics.get(objectId);
    if (metric !== undefined) {
      metric.visible = visible;
    }
    this.application.renderNextFrame = true;
  }

  releaseObject(objectId: string): void {
    const record = this.loadedObjects.get(objectId);
    if (record === undefined) {
      return;
    }
    record.entity.destroy();
    this.unloadAsset(record.asset);
    this.loadedObjects.delete(objectId);
    this.resourceMetrics.delete(objectId);
  }

  setRenderQuality(decision: QualityDecision): void {
    void decision;
  }

  getMetrics(): RendererMetrics {
    const stats = this.applicationValue?.stats.frame;
    const activeResource =
      this.activeFrame === undefined
        ? undefined
        : this.preparedFrames.get(this.activeFrame);
    return {
      ...(this.activeFrame === undefined
        ? {}
        : { activeFrameIndex: this.activeFrame.frameIndex }),
      failedResourceLoadCount: this.failedResourceLoadCount,
      ...(this.frameCommitTimeMs === undefined
        ? {}
        : { frameCommitTimeMs: this.frameCommitTimeMs }),
      ...(stats === undefined || stats.ms <= 0 ? {} : { frameTimeMs: stats.ms }),
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
      ...(stats === undefined || stats.renderTime < 0
        ? {}
        : { renderCallTimeMs: stats.renderTime }),
      ...(activeResource === undefined
        ? {}
        : { renderedSplatCount: activeResource.numSplats }),
      ...(stats === undefined || stats.fps <= 0
        ? {}
        : { renderFramesPerSecond: stats.fps }),
      resources: [...this.resourceMetrics.values()].map(
        (resource): RendererResourceMetrics => ({ ...resource }),
      ),
      ...(stats === undefined || stats.gsplatSort < 0
        ? {}
        : { sortTimeMs: stats.gsplatSort }),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.orbitControlsCleanup?.();
    this.orbitControlsCleanup = undefined;
    const disposalError = new Error("The PlayCanvas renderer adapter was disposed.");
    for (const cancel of [...this.pendingLoadCancellations]) {
      cancel(disposalError);
    }
    for (const cancel of [...this.pendingPresentationCancellations]) {
      cancel(disposalError);
    }
    for (const objectId of [...this.loadedObjects.keys()]) {
      this.releaseObject(objectId);
    }
    if (this.dynamicEntityValue?.gsplat !== undefined) {
      this.dynamicEntityValue.gsplat.enabled = false;
      clearGsplatAsset(this.dynamicEntityValue.gsplat);
    }
    for (const [, resource] of [...this.preparedFrames]) {
      this.unloadAsset(resource.asset);
    }
    this.dynamicEntityValue?.destroy();
    if (this.options.cameraEntity === undefined) {
      this.cameraEntityValue?.destroy();
    }
    if (this.options.application === undefined) {
      this.applicationValue?.destroy();
    }
    this.activeFrame = undefined;
    this.boundFrame = undefined;
    this.preparedFrames.clear();
    this.resourceMetrics.clear();
  }

  private async commitPreparedFrame(
    frame: PreparedFrame,
    resource: PlayCanvasPreparedResource,
  ): Promise<void> {
    this.assertInitialised();
    if (resource.releaseRequested) {
      return;
    }
    const startedAt = this.now();
    let ready: Promise<void> | undefined;
    await this.commitBeforeRender(() => {
      if (resource.releaseRequested) {
        return;
      }
      ready =
        this.options.waitForFrameReady === true ? this.waitForFrameReady() : undefined;
      applyPlayCanvasTransform(this.dynamicEntity, resource.transform);
      const component = this.dynamicEntity.gsplat!;
      component.asset = resource.asset;
      component.enabled = true;
      this.boundFrame = frame;
    });
    if (resource.releaseRequested) {
      return;
    }
    await ready;
    this.assertInitialised();
    if (resource.releaseRequested) {
      if (this.boundFrame === frame) {
        this.dynamicEntity.gsplat!.enabled = false;
        this.application.renderNextFrame = true;
      }
      return;
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
    this.frameCommitTimeMs = this.now() - startedAt;
  }

  private finaliseFrameRelease(
    frame: PreparedFrame,
    resource: PlayCanvasPreparedResource,
  ): void {
    if (this.preparedFrames.get(frame) !== resource) {
      return;
    }
    if (this.boundFrame === frame) {
      if (resource.releaseFinalisationScheduled) {
        return;
      }
      resource.releaseFinalisationScheduled = true;
      const application = this.application;
      application.renderNextFrame = true;
      application.once("frameend", () => {
        if (this.disposed || this.preparedFrames.get(frame) !== resource) {
          return;
        }
        if (this.boundFrame === frame) {
          const component = this.dynamicEntity.gsplat!;
          component.enabled = false;
          clearGsplatAsset(component);
          this.boundFrame = undefined;
        }
        this.preparedFrames.delete(frame);
        this.unloadAsset(resource.asset);
      });
      return;
    }
    this.preparedFrames.delete(frame);
    this.unloadAsset(resource.asset);
  }

  /**
   * Unified GSplat placements are cached by PlayCanvas between its
   * `framerender` streaming update and renderer reconciliation. Replacing a
   * component asset between frames destroys the cached placement and leaves a
   * null resource for the next streaming update. Commit during `prerender` so
   * PlayCanvas reconciles the new placement immediately in the same frame.
   */
  private commitBeforeRender(commit: () => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        event.off();
        this.pendingPresentationCancellations.delete(cancel);
        try {
          commit();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const cancel = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        event.off();
        this.pendingPresentationCancellations.delete(cancel);
        reject(error);
      };
      const event = this.application.once("prerender", finish);
      this.pendingPresentationCancellations.add(cancel);
      this.application.renderNextFrame = true;
    });
  }

  private waitForFrameReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const system = this.application.systems.gsplat;
      if (system === undefined) {
        reject(new Error("The PlayCanvas GSplat component system is unavailable."));
        return;
      }
      const dynamicLayerId = this.dynamicEntity.gsplat!.layers[0];
      const dynamicLayer =
        dynamicLayerId === undefined
          ? undefined
          : this.application.scene.layers.getLayerById(dynamicLayerId);
      if (dynamicLayer === undefined) {
        reject(new Error("The PlayCanvas dynamic GSplat layer is unavailable."));
        return;
      }
      let settled = false;
      const timeout = { id: undefined as ReturnType<typeof setTimeout> | undefined };
      const cleanup = () => {
        event.off();
        if (timeout.id !== undefined) {
          globalThis.clearTimeout(timeout.id);
        }
      };
      const cancel = (error: Error) => {
        if (!settled) {
          settled = true;
          cleanup();
          this.pendingPresentationCancellations.delete(cancel);
          reject(error);
        }
      };
      const event = system.on(
        "frame:ready",
        (camera: unknown, layer: unknown, ready: unknown, loadingCount: unknown) => {
          if (
            !settled &&
            camera === this.cameraEntity.camera &&
            layer === dynamicLayer &&
            ready === true &&
            loadingCount === 0
          ) {
            settled = true;
            cleanup();
            this.pendingPresentationCancellations.delete(cancel);
            resolve();
          }
        },
      );
      this.pendingPresentationCancellations.add(cancel);
      timeout.id = globalThis.setTimeout(
        () =>
          cancel(
            new Error(
              "Timed out waiting for the optional PlayCanvas frame-ready fence.",
            ),
          ),
        Math.max(1, this.options.frameReadyTimeoutMs ?? 5_000),
      );
    });
  }

  private async loadObject(
    object: StaticSceneObject | MeshSceneObject,
    kind: RendererObjectKind,
    assetType: "container" | "gsplat",
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
    const asset = new Asset(object.id, assetType, {
      filename: filenameFromUrl(object.url),
      url: object.url,
    });
    let entity: Entity | undefined;
    try {
      this.application.assets.add(asset);
      const progress = (receivedBytes: unknown, totalBytes: unknown) => {
        if (typeof receivedBytes !== "number") {
          return;
        }
        metric.loadedBytes = receivedBytes;
        if (typeof totalBytes === "number" && totalBytes > 0) {
          metric.totalBytes = totalBytes;
        }
        options.onProgress?.({
          ...(typeof totalBytes === "number" && totalBytes > 0
            ? { fraction: receivedBytes / totalBytes, totalBytes }
            : {}),
          loadedBytes: receivedBytes,
          objectId: object.id,
          url: object.url,
        });
      };
      const progressEvent = asset.on("progress", progress);
      try {
        await this.loadRegisteredAsset(asset, options.signal);
        this.assertInitialised();
      } finally {
        progressEvent.off();
      }
      throwIfAborted(options.signal);
      if (assetType === "gsplat") {
        entity = new Entity(`${object.id}-splat`, this.application);
        entity.addComponent("gsplat", { asset, unified: true });
      } else {
        entity = (asset.resource as ContainerResource).instantiateRenderEntity();
        entity.name = `${object.id}-mesh`;
      }
      applyPlayCanvasTransform(entity, object.transform);
      this.application.root.addChild(entity);
      metric.state = "ready";
      metric.visible = true;
      this.loadedObjects.set(object.id, { asset, entity, kind });
      return Object.freeze({ id: object.id, kind });
    } catch (error) {
      entity?.destroy();
      this.failedResourceLoadCount += 1;
      this.resourceMetrics.delete(object.id);
      this.unloadAsset(asset);
      throw error;
    }
  }

  private createSogAsset(name: string, url: string, contents: ArrayBuffer): Asset {
    const asset = new Asset(
      name,
      "gsplat",
      {
        contents,
        filename: filenameFromUrl(url, ".sog"),
        size: contents.byteLength,
        url,
      },
      { reorder: false },
    );
    this.application.assets.add(asset);
    return asset;
  }

  private loadAsset(asset: Asset, signal: AbortSignal | undefined): Promise<void> {
    return this.loadRegisteredAsset(asset, signal);
  }

  private loadRegisteredAsset(
    asset: Asset,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        loaded.off();
        failed.off();
        signal?.removeEventListener("abort", aborted);
        this.pendingLoadCancellations.delete(cancel);
      };
      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error === undefined) {
          resolve();
        } else {
          reject(toError(error, `Failed to load PlayCanvas asset '${asset.name}'.`));
        }
      };
      const cancel = (error: Error) => {
        // PlayCanvas has no cancellable asset parser. If it finishes after the
        // caller aborts, immediately release the late resource as well.
        asset.once("load", () => this.unloadAsset(asset));
        finish(error);
      };
      const aborted = () =>
        cancel(toError(signal?.reason, "The operation was aborted."));
      const loaded = asset.once("load", () => finish());
      const failed = asset.once("error", (error: unknown) => finish(error));
      this.pendingLoadCancellations.add(cancel);
      signal?.addEventListener("abort", aborted, { once: true });
      try {
        this.application.assets.load(asset);
      } catch (error) {
        finish(error);
      }
    });
  }

  private unloadAsset(asset: Asset): void {
    const application = this.applicationValue;
    if (application === undefined) {
      return;
    }
    application.assets.remove(asset);
    asset.unload();
  }

  private requirePreparedFrame(frame: PreparedFrame): PlayCanvasPreparedResource {
    const resource = this.preparedFrames.get(frame);
    if (resource === undefined || resource.releaseRequested) {
      throw new Error(
        `Frame ${frame.sequenceId}:${frame.frameIndex} is not prepared by this adapter.`,
      );
    }
    return resource;
  }

  private requireObject(objectId: string): LoadedObjectRecord {
    const record = this.loadedObjects.get(objectId);
    if (record === undefined) {
      throw new Error(`Renderer object '${objectId}' is not loaded.`);
    }
    return record;
  }

  private frameResourceId(frame: PreparedFrame): string {
    return `${frame.sequenceId}:${frame.frameIndex}:${frame.qualityLevel}`;
  }

  private assertInitialised(): void {
    this.assertNotDisposed();
    if (!this.initialised) {
      throw new Error("The PlayCanvas renderer adapter has not been initialised.");
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("The PlayCanvas renderer adapter has been disposed.");
    }
  }

  private requireInitialised<T>(value: T | undefined, name: string): T {
    this.assertInitialised();
    if (value === undefined) {
      throw new Error(`The PlayCanvas renderer ${name} is unavailable.`);
    }
    return value;
  }
}

function readSplatCount(asset: Asset): number {
  const resource = asset.resource as GSplatResourceBase | undefined;
  if (resource === undefined || typeof resource.numSplats !== "number") {
    throw new Error(
      `PlayCanvas asset '${asset.name}' did not produce a GSplat resource.`,
    );
  }
  return resource.numSplats;
}

function clearGsplatAsset(component: { asset: Asset | number }): void {
  // PlayCanvas accepts null here and uses it internally, but its public type
  // currently omits null from the setter declaration.
  (component as unknown as { asset: Asset | number | null }).asset = null;
}

function releaseSourceContents(asset: Asset): void {
  // Reassigning Asset.file makes PlayCanvas reload the asset. Clear only the
  // parser input retained by AssetFile after its WebP textures are resident.
  const file = asset.file as { contents?: ArrayBuffer | null } | null;
  if (file !== null) {
    file.contents = null;
  }
}

function filenameFromUrl(url: string, fallback = "asset.bin"): string {
  const withoutQuery = url.split(/[?#]/u, 1)[0] ?? "";
  const filename = withoutQuery.split("/").pop();
  return filename === undefined || filename.length === 0 ? fallback : filename;
}

function installOrbitControls(
  canvas: HTMLCanvasElement,
  camera: Entity,
  application: Application,
): () => void {
  const target = { x: 0, y: 0, z: 0 };
  let radius = 3;
  let yaw = 0;
  let pitch = 0;
  let activeButton: number | undefined;
  let previousX = 0;
  let previousY = 0;

  const updateCamera = () => {
    const pitchCosine = Math.cos(pitch);
    camera.setPosition(
      target.x + radius * Math.sin(yaw) * pitchCosine,
      target.y + radius * Math.sin(pitch),
      target.z + radius * Math.cos(yaw) * pitchCosine,
    );
    camera.lookAt(target.x, target.y, target.z);
    application.renderNextFrame = true;
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    activeButton = event.button;
    previousX = event.clientX;
    previousY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const pointerMove = (event: PointerEvent) => {
    if (activeButton === undefined) {
      return;
    }
    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;
    previousX = event.clientX;
    previousY = event.clientY;
    if (activeButton === 0) {
      yaw -= deltaX * 0.005;
      pitch = Math.max(
        -Math.PI * 0.49,
        Math.min(Math.PI * 0.49, pitch + deltaY * 0.005),
      );
    } else {
      const panScale = radius * 0.0015;
      target.x -= deltaX * panScale;
      target.y += deltaY * panScale;
    }
    updateCamera();
    event.preventDefault();
  };
  const pointerUp = (event: PointerEvent) => {
    if (activeButton !== undefined) {
      activeButton = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }
  };
  const wheel = (event: WheelEvent) => {
    radius = Math.max(0.1, Math.min(100, radius * Math.exp(event.deltaY * 0.001)));
    updateCamera();
    event.preventDefault();
  };
  const contextMenu = (event: MouseEvent) => event.preventDefault();

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", contextMenu);

  return () => {
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp);
    canvas.removeEventListener("pointercancel", pointerUp);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("contextmenu", contextMenu);
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason ?? abortError();
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(String(value || fallback));
}
