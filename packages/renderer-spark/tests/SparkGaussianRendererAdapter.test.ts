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
  mappingVersion = 0;
  maxSh = 3;
  numSplats = 0;
  opacity = 1;
  paged?: SplatMesh["paged"];
  readonly updateGenerator = vi.fn();

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
  const setDirty = vi.fn();
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
    behindFoveate: 0.2,
    coneFov: 120,
    coneFov0: 90,
    coneFoveate: 0.4,
    dispose: vi.fn(),
    enableLod: true,
    lodRenderScale: 1,
    lodDirty: false,
    lodSplatScale: 1,
    lodSplatCount: undefined as number | undefined,
    pager: {
      maxPages: 4,
      pageToSplatsChunk: [
        { chunk: 0, splats: {}, time: 1 },
        undefined,
        { chunk: 1, splats: {}, time: 2 },
      ],
    },
    setDirty,
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
    setDirty,
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
      failedResourceLoadCount: 0,
      gpuPageCapacity: 4,
      gpuPageCount: 2,
      loadedMeshObjectCount: 0,
      loadedStaticObjectCount: 2,
      loadingResourceCount: 0,
      preparedFrameCount: 0,
      renderedSplatCount: 321,
      resources: [
        expect.objectContaining({ id: "room", state: "ready", visible: true }),
        expect.objectContaining({ id: "desk", state: "ready", visible: true }),
      ],
    });

    adapter.setObjectVisibility("room", false);
    expect(harness.splatMeshes[0]?.visible).toBe(false);
    harness.spark.lodDirty = false;
    harness.setDirty.mockClear();
    adapter.setObjectTransform("room", {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 8, 9, 10, 1],
    });
    expect(harness.splatMeshes[0]?.matrixAutoUpdate).toBe(false);
    expect(harness.splatMeshes[0]?.matrix.elements.slice(12, 15)).toEqual([8, 9, 10]);
    expect(harness.spark.lodDirty).toBe(true);
    expect(harness.setDirty).toHaveBeenCalled();

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
    expect(adapter.getMetrics().failedResourceLoadCount).toBe(1);
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
    const preparationTrace = vi.fn();
    const first = await adapter.prepareFrame(
      "actor",
      { frameIndex: 0, timestampSeconds: 0, url: "/frame-0.rad" },
      {
        onTrace: preparationTrace,
        transform: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { w: 0, x: 1, y: 0, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        },
      },
    );
    expect(preparationTrace.mock.calls.map(([event]) => event.phase)).toEqual([
      "resource-created",
      "resource-initialized",
      "metadata-ready",
      "minimum-renderable",
    ]);
    expect(preparationTrace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        elapsedMs: expect.any(Number),
        phase: "minimum-renderable",
        quality: expect.objectContaining({ state: expect.any(String) }),
      }),
    );
    const second = await adapter.prepareFrame(
      "actor",
      { frameIndex: 1, timestampSeconds: 1 / 30, url: "/frame-1.rad" },
      { targetQualityLevel: 2 },
    );

    expect(harness.splatMeshes[0]?.visible).toBe(false);
    expect(harness.splatMeshes[0]?.position.toArray()).toEqual([1, 2, 3]);
    expect(harness.splatMeshes[0]?.quaternion.toArray()).toEqual([1, 0, 0, 0]);
    expect(harness.splatMeshes[0]?.scale.toArray()).toEqual([2, 2, 2]);
    adapter.presentFrame(first);
    expect(harness.splatMeshes[0]?.visible).toBe(true);
    adapter.presentFrame(second);
    expect(harness.splatMeshes[0]).toMatchObject({
      lodScale: 0,
      opacity: 0,
      visible: true,
    });
    expect(harness.splatMeshes[1]?.visible).toBe(true);
    expect(adapter.getMetrics().activeFrameIndex).toBe(1);
    expect(adapter.getMetrics().preparedFrameCount).toBe(2);
    expect(second.qualityLevel).toBe(2);
    expect(adapter.getFrameSlotSnapshots()).toEqual([
      expect.objectContaining({ frameIndex: 0, state: "ready", visible: false }),
      expect.objectContaining({ frameIndex: 1, state: "ready", visible: true }),
    ]);

    adapter.setFrameTransform(first, {
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 0.75, y: 0.75, z: 0.75 },
    });
    adapter.setFrameTransform(second, {
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.5, z: 1.5 },
    });
    expect(harness.splatMeshes[0]?.quaternion.toArray()).toEqual([1, 0, 0, 0]);
    expect(harness.splatMeshes[0]?.scale.toArray()).toEqual([0.75, 0.75, 0.75]);
    expect(harness.splatMeshes[1]?.quaternion.toArray()).toEqual([1, 0, 0, 0]);
    expect(harness.splatMeshes[1]?.scale.toArray()).toEqual([1.5, 1.5, 1.5]);
    expect(harness.splatMeshes[0]?.dispose).not.toHaveBeenCalled();
    expect(harness.splatMeshes[1]?.dispose).not.toHaveBeenCalled();

    adapter.releaseFrame(second);
    expect(harness.splatMeshes[1]?.dispose).toHaveBeenCalledOnce();
    expect(adapter.getMetrics().activeFrameIndex).toBeUndefined();
    expect(adapter.getMetrics().preparedFrameCount).toBe(1);
  });

  it("loads a fixed SPZ tier without paging or LoD traversal", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    const preparationTrace = vi.fn();
    const preparation = adapter.prepareFrame(
      "actor",
      {
        byteSize: 845_127,
        frameIndex: 0,
        timestampSeconds: 0,
        url: "/frame0001-minimum.spz",
      },
      {
        onTrace: preparationTrace,
        targetQualityLevel: 1,
        transferQuality: {
          detailLevel: 0.25,
          level: 1,
          mode: "fixed",
          splatCount: 68_535,
        },
      },
    );
    const mesh = harness.splatMeshes[0];
    if (mesh === undefined) {
      throw new Error("Expected the flat frame mesh to be created synchronously.");
    }
    mesh.numSplats = 68_535;
    await vi.waitFor(() => {
      expect(mesh).toMatchObject({ opacity: 0, visible: true });
    });
    adapter.render();
    const prepared = await preparation;

    expect(harness.splatOptions[0]).toMatchObject({
      enableLod: false,
      lod: false,
      paged: false,
      url: "/frame0001-minimum.spz",
    });
    expect(preparationTrace.mock.calls.map(([event]) => event.phase)).toEqual([
      "resource-created",
      "resource-initialized",
      "flat-decode",
      "flat-render-fence",
      "minimum-renderable",
    ]);
    expect(mesh).toMatchObject({ opacity: 1, visible: false });
    await expect(
      adapter.refineFrame(prepared, {
        detailLevel: 0.25,
        minimumSplatCount: 100,
      }),
    ).resolves.toMatchObject({
      achievedDetailLevel: 0.25,
      selectedSplatCount: 68_535,
      state: "presentable",
    });
    await expect(
      adapter.refineFrame(prepared, {
        detailLevel: 0.5,
        minimumSplatCount: 100,
      }),
    ).rejects.toThrow(/below the requested/);

    adapter.presentFrame(prepared);
    expect(mesh).toMatchObject({ opacity: 1, visible: true });
  });

  it("keeps a paged frame transparent until its root LoD page is resident", async () => {
    const harness = createHarness();
    const initialiser = deferred<void>();
    harness.splatInitialisers.push(initialiser.promise);
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    let rootPageReady = false;
    const preparationTrace = vi.fn();
    const preparation = adapter.prepareFrame(
      "actor",
      { frameIndex: 0, timestampSeconds: 0, url: "/frame-0.rad" },
      { onTrace: preparationTrace },
    );
    const mesh = harness.splatMeshes[0];
    if (mesh === undefined) {
      throw new Error("Expected the frame mesh to be created synchronously.");
    }
    const readyUploads: { page: number }[] = [];
    const getSplatsChunk = vi.fn(() =>
      rootPageReady ? { lru: 0, page: 0 } : undefined,
    );
    const prepareChunk = vi.fn(async () => ({ chunk: 0, page: 0, reusedPage: false }));
    mesh.paged = {
      pager: { getSplatsChunk, newUploads: [], prepareChunk, readyUploads },
    } as unknown as NonNullable<SplatMesh["paged"]>;
    initialiser.resolve();

    await vi.waitFor(() => {
      expect(mesh.visible).toBe(true);
      expect(mesh.opacity).toBe(0);
      expect(mesh.lodScale).toBe(0);
      expect(adapter.getFrameSlotSnapshots()[0]).toMatchObject({
        state: "loading",
        visible: false,
      });
    });

    mesh.paged.onPreparation?.({
      atMs: 1,
      chunk: 0,
      durationMs: 12.5,
      page: 0,
      phase: "gpu-upload",
      reusedPage: false,
    });
    expect(preparationTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkIndex: 0,
        pageIndex: 0,
        phase: "gpu-upload",
        reusedPage: false,
        stageDurationMs: 12.5,
      }),
    );

    rootPageReady = true;
    readyUploads.push({ page: 0 });
    let preparationResolved = false;
    void preparation.then(() => {
      preparationResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preparationResolved).toBe(false);
    readyUploads.pop();
    const prepared = await preparation;
    expect(prepareChunk).toHaveBeenCalledWith(mesh.paged, 0, {
      signal: expect.any(AbortSignal),
    });
    expect(getSplatsChunk).toHaveBeenCalled();
    expect(adapter.getFrameSlotSnapshots()[0]).toMatchObject({
      state: "ready",
      visible: false,
    });

    adapter.presentFrame(prepared);
    expect(mesh.opacity).toBe(1);
    expect(mesh.visible).toBe(true);
    expect(adapter.getFrameSlotSnapshots()[0]).toMatchObject({ visible: true });
    expect(harness.spark.lodDirty).toBe(true);
    expect(harness.spark.setDirty).toHaveBeenCalled();
  });

  it("does not mark a paged frame presentable until demanded pages are uploaded and stable", async () => {
    const harness = createHarness();
    const initialiser = deferred<void>();
    harness.splatInitialisers.push(initialiser.promise);
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    const preparation = adapter.prepareFrame(
      "actor",
      { frameIndex: 0, timestampSeconds: 0, url: "/frame-0.rad" },
      {},
    );
    const mesh = harness.splatMeshes[0];
    if (mesh === undefined) {
      throw new Error("Expected the frame mesh to be created synchronously.");
    }

    const mappings: Array<{ lru: number; page: number } | undefined> = [
      { lru: 0, page: 0 },
      undefined,
    ];
    const newUploads: Array<{ page: number }> = [];
    const readyUploads: Array<{ page: number }> = [];
    const fetchPriority: Array<{ chunk: number; splats: unknown }> = [];
    const pager = {
      fetchers: [],
      fetched: [],
      fetchPriority,
      getSplatsChunk: vi.fn((_splats: unknown, chunk: number) => mappings[chunk]),
      lodTreeUpdates: [],
      newUploads,
      readyUploads,
      splatsChunkToPage: new Map<unknown, typeof mappings>(),
    };
    const paged = {
      getRadMeta: vi.fn(async () => ({
        meta: {
          chunks: [{ bytes: 100 }, { bytes: 300 }],
          count: 1_000,
        },
      })),
      numSplats: 1,
      pager,
    };
    pager.splatsChunkToPage.set(paged, mappings);
    fetchPriority.push({ chunk: 0, splats: paged }, { chunk: 1, splats: paged });
    mesh.paged = paged as unknown as NonNullable<SplatMesh["paged"]>;
    initialiser.resolve();
    const prepared = await preparation;

    expect(adapter.getFramePresentationQuality(prepared)).toMatchObject({
      achievedDetailLevel: 0,
      loadedBytes: 100,
      selectedSplatCount: 1,
      state: "root-ready",
      totalBytes: 400,
    });

    let refinementResolved = false;
    const refinement = adapter.refineFrame(prepared, {
      detailLevel: 0.25,
      minimumSplatCount: 100,
    });
    void refinement.then(() => {
      refinementResolved = true;
    });
    expect(mesh).toMatchObject({ lodScale: 0.25, visible: true, opacity: 0 });

    mappings[1] = { lru: 0, page: 1 };
    newUploads.push({ page: 1 });
    paged.numSplats = 100;
    mesh.mappingVersion = 1;
    adapter.render();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refinementResolved).toBe(false);

    newUploads.pop();
    mesh.mappingVersion = 2;
    adapter.render();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refinementResolved).toBe(false);

    mesh.mappingVersion = 3;
    adapter.render();
    await expect(refinement).resolves.toMatchObject({
      achievedDetailLevel: 0.25,
      demandedPageCount: 2,
      detailLevel: 0.25,
      loadedBytes: 400,
      selectedSplatCount: 100,
      state: "presentable",
      requestedDetailLevel: 0.25,
    });

    adapter.setFrameTransform(prepared, {
      scale: { x: 1.25, y: 1.25, z: 1.25 },
    });
    expect(mesh.scale.toArray()).toEqual([1.25, 1.25, 1.25]);
    expect(adapter.getFramePresentationQuality(prepared)).toMatchObject({
      achievedDetailLevel: 0,
      detailLevel: 0.25,
      state: "refining",
    });

    adapter.presentFrame(prepared);
    expect(mesh).toMatchObject({ lodScale: 0.25, opacity: 1, visible: true });

    mappings[1] = undefined;
    paged.numSplats = 1;
    mesh.mappingVersion = 4;
    expect(adapter.getFramePresentationQuality(prepared)).toMatchObject({
      detailLevel: 0.25,
      loadedBytes: 100,
      state: "refining",
    });
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
      frameTimeMs: 40,
      renderCallTimeMs: 20,
      renderFramesPerSecond: 25,
    });
  });

  it("batches Spark update, sort, render-call, and cadence diagnostics", async () => {
    const harness = createHarness();
    const timing = vi.fn();
    const instrumented = harness.spark as unknown as {
      driveSort(): Promise<void>;
      sortDirty: boolean;
      sorting: boolean;
      updateInternal(): Promise<void>;
    };
    instrumented.sortDirty = true;
    instrumented.sorting = false;
    instrumented.driveSort = vi.fn(async () => {
      instrumented.sorting = true;
      await Promise.resolve();
      instrumented.sorting = false;
    });
    instrumented.updateInternal = vi.fn(async () => {
      await instrumented.driveSort();
    });
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      onRenderTiming: timing,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();

    await instrumented.updateInternal();
    for (let index = 0; index < 15; index += 1) {
      adapter.render();
    }

    expect(timing).toHaveBeenCalledWith(
      expect.objectContaining({
        renderCallSamplesMs: expect.arrayContaining([20]),
        renderIntervalSamplesMs: expect.arrayContaining([40]),
        sortSamplesMs: [expect.any(Number)],
        sparkUpdateSamplesMs: [expect.any(Number)],
      }),
    );
  });

  it("reports in-flight frame resources and cancels their slots", async () => {
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
    const preparation = adapter.prepareFrame(
      "actor",
      { frameIndex: 4, timestampSeconds: 4 / 30, url: "/frame-4.rad" },
      { signal: controller.signal },
    );

    expect(adapter.getMetrics()).toMatchObject({
      loadingResourceCount: 1,
      preparedFrameCount: 0,
      resources: [
        expect.objectContaining({
          id: "actor:4:slot-0",
          kind: "dynamic-frame",
          loadedBytes: 25,
          state: "loading",
        }),
      ],
    });
    expect(adapter.getFrameSlotSnapshots()).toEqual([
      expect.objectContaining({
        sequenceId: "actor",
        state: "loading",
        visible: false,
      }),
    ]);

    controller.abort();
    await expect(preparation).rejects.toBeInstanceOf(SparkRendererAbortError);
    pending.resolve();
    await Promise.resolve();
    expect(adapter.getMetrics()).toMatchObject({
      failedResourceLoadCount: 0,
      loadingResourceCount: 0,
      preparedFrameCount: 0,
      resources: [],
    });
    expect(harness.splatMeshes[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("applies and reads complete Spark LoD, weighting, foveation, and SH controls", async () => {
    const harness = createHarness();
    const adapter = new SparkGaussianRendererAdapter({
      autoRender: false,
      renderer: harness.renderer,
      runtime: harness.runtime,
      scene: harness.scene,
    });
    await adapter.initialise();
    await adapter.loadStaticObject({ id: "room", url: "/room.rad" });
    const prepared = await adapter.prepareFrame(
      "actor",
      { frameIndex: 0, timestampSeconds: 0, url: "/frame-0.rad" },
      {},
    );

    adapter.setSparkRenderQuality({
      dynamicSequenceWeights: { actor: 0.75 },
      enableLod: true,
      foveation: {
        behindScale: 0.1,
        fullDetailFovDegrees: 70,
        peripheralDetailFovDegrees: 130,
        peripheralScale: 0.35,
      },
      lodRenderScale: 1.5,
      lodSplatScale: 1.25,
      maximumSphericalHarmonics: 2,
      objectWeights: { room: 0.5 },
      splatBudget: 800_000,
      staticSceneWeight: 2,
    });

    expect(harness.spark).toMatchObject({
      behindFoveate: 0.1,
      coneFov: 130,
      coneFov0: 70,
      coneFoveate: 0.35,
      enableLod: true,
      lodRenderScale: 1.5,
      lodSplatCount: 800_000,
      lodSplatScale: 1.25,
    });
    expect(harness.splatMeshes[0]).toMatchObject({ lodScale: 1, maxSh: 2 });
    expect(harness.splatMeshes[1]).toMatchObject({
      lodScale: 0,
      maxSh: 2,
    });
    adapter.setFrameRefinement(prepared, true);
    expect(harness.splatMeshes[1]).toMatchObject({ lodScale: 0.75, maxSh: 2 });
    adapter.presentFrame(prepared);
    expect(harness.splatMeshes[1]).toMatchObject({ lodScale: 0.75, maxSh: 2 });
    expect(harness.splatMeshes[0]?.updateGenerator).toHaveBeenCalledOnce();
    expect(harness.splatMeshes[1]?.updateGenerator).toHaveBeenCalledOnce();

    const effective = adapter.getSparkRenderQuality();
    expect(effective).toMatchObject({
      dynamicSequenceWeights: { actor: 0.75 },
      maximumSphericalHarmonics: 2,
      objectWeights: { room: 0.5 },
      splatBudget: 800_000,
    });
    (effective.objectWeights as Record<string, number>).room = 99;
    expect(adapter.getSparkRenderQuality().objectWeights.room).toBe(0.5);

    expect(() =>
      adapter.setSparkRenderQuality({
        ...effective,
        foveation: {
          ...effective.foveation,
          peripheralDetailFovDegrees: 20,
        },
      }),
    ).toThrow(SparkRendererStateError);
  });
});
