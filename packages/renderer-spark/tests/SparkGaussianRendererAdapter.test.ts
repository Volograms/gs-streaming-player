import { SplatMesh } from "@sparkjsdev/spark";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  SparkGaussianRendererAdapter,
  SparkRendererAbortError,
  SparkRendererStateError,
} from "../src/index.js";

import type { SparkRendererRuntime } from "../src/index.js";
import type { SplatMeshOptions, SparkRenderer } from "@sparkjsdev/spark";
import type { WebGLRenderer } from "three";

class FakeSplatMesh extends Object3D {
  readonly dispose = vi.fn();
  readonly initialized: Promise<FakeSplatMesh>;
  lodScale = 1;

  constructor(initialise?: Promise<void>) {
    super();
    this.initialized = (initialise ?? Promise.resolve()).then(() => this);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return { promise, reject, resolve };
}

function asSplatMesh(mesh: FakeSplatMesh): SplatMesh {
  return mesh as unknown as SplatMesh;
}

function createHarness() {
  const canvas = {
    clientHeight: 360,
    clientWidth: 640,
    height: 1,
    width: 1,
  } as HTMLCanvasElement;
  const rendererDispose = vi.fn();
  const render = vi.fn();
  const setAnimationLoop = vi.fn();
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();
  const renderer = {
    dispose: rendererDispose,
    domElement: canvas,
    render,
    setAnimationLoop,
    setPixelRatio,
    setSize,
  } as unknown as WebGLRenderer;
  const spark = Object.assign(new Object3D(), {
    activeSplats: 321,
    dispose: vi.fn(),
    lodSplatCount: undefined as number | undefined,
  }) as unknown as SparkRenderer;
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const splatMeshes: FakeSplatMesh[] = [];
  const splatInitialisers: Promise<void>[] = [];
  const gltfLoads: Promise<{ scene: Group }>[] = [];
  const splatOptions: SplatMeshOptions[] = [];
  const resizeDisconnect = vi.fn();
  const resizeObserve = vi.fn();
  const createRenderer = vi.fn(() => renderer);
  let now = 100;

  const runtime: SparkRendererRuntime = {
    createCamera: () => camera,
    createGltfLoader: () => ({
      loadAsync: vi.fn(async (_url, onProgress) => {
        onProgress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as ProgressEvent);
        return gltfLoads.shift() ?? Promise.resolve({ scene: new Group() });
      }),
    }),
    createRenderer,
    createResizeObserver: () => ({
      disconnect: resizeDisconnect,
      observe: resizeObserve,
    }),
    createScene: () => scene,
    createSparkRenderer: () => spark,
    createSplatMesh: (options) => {
      splatOptions.push(options);
      options.onProgress?.({
        lengthComputable: true,
        loaded: 25,
        total: 100,
      } as ProgressEvent);
      const mesh = new FakeSplatMesh(splatInitialisers.shift());
      splatMeshes.push(mesh);
      return asSplatMesh(mesh);
    },
    devicePixelRatio: () => 2,
    now: () => {
      now += 20;
      return now;
    },
  };

  return {
    camera,
    canvas,
    createRenderer,
    gltfLoads,
    renderer,
    rendererDispose,
    render,
    resizeDisconnect,
    resizeObserve,
    runtime,
    scene,
    setAnimationLoop,
    setPixelRatio,
    setSize,
    spark,
    splatInitialisers,
    splatMeshes,
    splatOptions,
  };
}

describe("SparkGaussianRendererAdapter", () => {
  it("initialises against a caller canvas and disposes only owned resources", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      canvas: harness.canvas,
      runtime: harness.runtime,
      scene: harness.scene,
    });

    await adapter.initialise();

    expect(harness.createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        antialias: false,
        canvas: harness.canvas,
      }),
    );
    expect(adapter.scene).toBe(harness.scene);
    expect(harness.scene.children).toContain(harness.spark);
    expect(harness.setPixelRatio).toHaveBeenCalledWith(2);
    expect(harness.setSize).toHaveBeenCalledWith(640, 360, false);
    expect(harness.resizeObserve).toHaveBeenCalledWith(harness.canvas);
    expect(harness.setAnimationLoop).toHaveBeenCalledWith(adapter.render);

    adapter.dispose();

    expect(harness.scene.children).not.toContain(harness.spark);
    expect(harness.spark.dispose).toHaveBeenCalledOnce();
    expect(harness.rendererDispose).toHaveBeenCalledOnce();
    expect(harness.resizeDisconnect).toHaveBeenCalledOnce();
  });

  it("does not dispose or take over a caller-owned renderer", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });

    await adapter.initialise();
    adapter.dispose();

    expect(harness.createRenderer).not.toHaveBeenCalled();
    expect(harness.setAnimationLoop).not.toHaveBeenCalled();
    expect(harness.rendererDispose).not.toHaveBeenCalled();
  });

  it("loads multiple static splats with progress, transforms, and independent lifetime", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    const progress = vi.fn();
    await adapter.initialise();

    const first = await adapter.loadStaticObject(
      {
        id: "room",
        transform: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        },
        url: "/room.rad",
      },
      { onProgress: progress },
    );
    const second = await adapter.loadStaticObject({ id: "desk", url: "/desk.rad" });

    expect(first).toEqual({ id: "room", kind: "static-splat" });
    expect(second).toEqual({ id: "desk", kind: "static-splat" });
    expect(harness.splatOptions).toEqual([
      expect.objectContaining({ paged: true, url: "/room.rad" }),
      expect.objectContaining({ paged: true, url: "/desk.rad" }),
    ]);
    expect(progress).toHaveBeenCalledWith({
      fraction: 0.25,
      loadedBytes: 25,
      objectId: "room",
      totalBytes: 100,
      url: "/room.rad",
    });
    expect(harness.splatMeshes[0]?.position.toArray()).toEqual([1, 2, 3]);
    expect(harness.splatMeshes[0]?.scale.toArray()).toEqual([2, 2, 2]);
    expect(adapter.getMetrics()).toMatchObject({
      loadedMeshObjectCount: 0,
      loadedStaticObjectCount: 2,
      renderedSplatCount: 321,
    });

    adapter.setObjectVisibility("room", false);
    expect(harness.splatMeshes[0]?.visible).toBe(false);
    adapter.setObjectTransform("room", {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 8, 9, 10, 1],
    });
    expect(harness.splatMeshes[0]?.matrixAutoUpdate).toBe(false);
    expect(harness.splatMeshes[0]?.matrix.elements.slice(12, 15)).toEqual([8, 9, 10]);

    adapter.releaseObject("room");
    expect(harness.splatMeshes[0]?.dispose).toHaveBeenCalledOnce();
    expect(adapter.getMetrics().loadedStaticObjectCount).toBe(1);
  });

  it("keeps renderer state valid after an individual splat fails", async () => {
    const harness = createHarness();
    harness.splatInitialisers.push(Promise.reject(new Error("bad RAD")));
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();

    await expect(
      adapter.loadStaticObject({ id: "broken", url: "/broken.rad" }),
    ).rejects.toThrow("bad RAD");
    expect(adapter.getMetrics().loadedStaticObjectCount).toBe(0);
    expect(harness.splatMeshes[0]?.dispose).toHaveBeenCalledOnce();

    await expect(
      adapter.loadStaticObject({ id: "broken", url: "/fixed.rad" }),
    ).resolves.toEqual({ id: "broken", kind: "static-splat" });
    expect(adapter.getMetrics().loadedStaticObjectCount).toBe(1);
  });

  it("loads and disposes conventional meshes using the same transform convention", async () => {
    const harness = createHarness();
    const geometry = new BoxGeometry();
    const material = new MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const root = new Group();
    root.add(new Mesh(geometry, material));
    harness.gltfLoads.push(Promise.resolve({ scene: root }));
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    const progress = vi.fn();
    await adapter.initialise();

    await expect(
      adapter.loadMesh(
        {
          id: "table",
          transform: { position: { x: 4, y: 5, z: 6 } },
          url: "/table.glb",
        },
        { onProgress: progress },
      ),
    ).resolves.toEqual({ id: "table", kind: "mesh" });

    expect(root.position.toArray()).toEqual([4, 5, 6]);
    expect(progress).toHaveBeenCalledWith({
      fraction: 0.5,
      loadedBytes: 50,
      objectId: "table",
      totalBytes: 100,
      url: "/table.glb",
    });
    expect(adapter.getMetrics().loadedMeshObjectCount).toBe(1);

    adapter.setObjectVisibility("table", false);
    expect(root.visible).toBe(false);
    adapter.releaseObject("table");
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(root.parent).toBeNull();
  });

  it("prepares, presents, switches, and releases dynamic frames", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    const first = await adapter.prepareFrame(
      "actor",
      { frameIndex: 0, timestampSeconds: 0, url: "/frame-0.rad" },
      {},
    );
    const second = await adapter.prepareFrame(
      "actor",
      { frameIndex: 1, timestampSeconds: 1 / 30, url: "/frame-1.rad" },
      { targetQualityLevel: 2 },
    );

    expect(harness.splatMeshes[0]?.visible).toBe(false);
    adapter.presentFrame(first);
    expect(harness.splatMeshes[0]?.visible).toBe(true);
    adapter.presentFrame(second);
    expect(harness.splatMeshes[0]?.visible).toBe(false);
    expect(harness.splatMeshes[1]?.visible).toBe(true);
    expect(adapter.getMetrics().activeFrameIndex).toBe(1);
    expect(second.qualityLevel).toBe(2);

    adapter.releaseFrame(second);
    expect(harness.splatMeshes[1]?.dispose).toHaveBeenCalledOnce();
    expect(adapter.getMetrics().activeFrameIndex).toBeUndefined();
  });

  it("rejects cancelled and duplicate operations without corrupting loaded state", async () => {
    const harness = createHarness();
    const pending = deferred<void>();
    harness.splatInitialisers.push(pending.promise);
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    const controller = new AbortController();
    const loading = adapter.loadStaticObject(
      { id: "room", url: "/room.rad" },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(loading).rejects.toBeInstanceOf(SparkRendererAbortError);
    pending.resolve();
    await Promise.resolve();
    expect(adapter.getMetrics().loadedStaticObjectCount).toBe(0);

    await adapter.loadStaticObject({ id: "room", url: "/room.rad" });
    await expect(
      adapter.loadStaticObject({ id: "room", url: "/duplicate.rad" }),
    ).rejects.toBeInstanceOf(SparkRendererStateError);
    expect(adapter.getMetrics().loadedStaticObjectCount).toBe(1);
  });

  it("applies quality budgets and reports render timing", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();

    adapter.setRenderQuality({
      allowStaticRefinement: true,
      dynamicObjectWeights: {},
      maximumRefinementBytes: 0,
      renderSplatBudget: 1234.8,
      staticObjectWeight: 1,
      targetBufferSeconds: 1,
    });
    adapter.render();
    adapter.render();

    expect(harness.spark.lodSplatCount).toBe(1234);
    expect(harness.render).toHaveBeenCalledTimes(2);
    expect(adapter.getMetrics()).toMatchObject({
      frameTimeMs: 20,
      renderFramesPerSecond: 50,
    });
  });
});
