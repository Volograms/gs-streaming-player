import {
  GSPLAT_RENDERER_AUTO,
  GSPLAT_RENDERER_RASTER_CPU_SORT,
  GSPLAT_RENDERER_RASTER_GPU_SORT,
} from "playcanvas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configurePlayCanvasGraphicsBackend,
  queryPlayCanvasImmersiveVrSupport,
  readPlayCanvasRendererRuntimeInfo,
} from "../src/graphicsBackend.js";

import type { Application } from "playcanvas";

function createApplication(
  graphicsBackend: "webgl2" | "webgpu",
  initialRenderer: number,
): Application {
  let requestedRenderer = GSPLAT_RENDERER_AUTO;
  let currentRenderer = initialRenderer;
  return {
    graphicsDevice: {
      deviceType: graphicsBackend,
    },
    xr: {
      fixedFoveation: null,
    },
    scene: {
      gsplat: {
        get currentRenderer() {
          return currentRenderer;
        },
        get renderer() {
          return requestedRenderer;
        },
        set renderer(value: number) {
          requestedRenderer = value;
          currentRenderer =
            value === GSPLAT_RENDERER_RASTER_GPU_SORT ||
            value === GSPLAT_RENDERER_RASTER_CPU_SORT
              ? value
              : initialRenderer;
        },
      },
      gsplatCentersEnabled: true,
    },
  } as unknown as Application;
}

describe("PlayCanvas graphics backend configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects GPU sort and removes CPU-center preparation on WebGPU", () => {
    const application = createApplication("webgpu", GSPLAT_RENDERER_RASTER_GPU_SORT);

    const runtime = configurePlayCanvasGraphicsBackend(application, "webgpu");

    expect(application.scene.gsplat.renderer).toBe(GSPLAT_RENDERER_RASTER_GPU_SORT);
    expect(application.scene.gsplatCentersEnabled).toBe(false);
    expect(runtime).toEqual({
      gaussianSort: "gpu",
      graphicsBackend: "webgpu",
      splatCentersEnabled: false,
      xrFixedFoveation: null,
    });
  });

  it("rejects a fallback backend instead of mislabelling the benchmark", () => {
    const application = createApplication("webgl2", GSPLAT_RENDERER_RASTER_CPU_SORT);

    expect(() => configurePlayCanvasGraphicsBackend(application, "webgpu")).toThrow(
      /requested.*selected webgl2/i,
    );
    expect(application.scene.gsplatCentersEnabled).toBe(true);
  });

  it("allows the CPU-sort renderer to run on WebGPU for comparison", () => {
    const application = createApplication("webgpu", GSPLAT_RENDERER_RASTER_GPU_SORT);

    const runtime = configurePlayCanvasGraphicsBackend(application, "webgpu", "cpu");

    expect(application.scene.gsplat.renderer).toBe(GSPLAT_RENDERER_RASTER_CPU_SORT);
    expect(application.scene.gsplatCentersEnabled).toBe(true);
    expect(runtime).toEqual({
      gaussianSort: "cpu",
      graphicsBackend: "webgpu",
      splatCentersEnabled: true,
      xrFixedFoveation: null,
    });
  });

  it("rejects GPU sorting on WebGL2", () => {
    const application = createApplication("webgl2", GSPLAT_RENDERER_RASTER_CPU_SORT);

    expect(() =>
      configurePlayCanvasGraphicsBackend(application, "webgl2", "gpu"),
    ).toThrow(/GPU Gaussian sorting requires WebGPU/i);
  });

  it("reports the WebGL CPU-sort baseline", () => {
    const application = createApplication("webgl2", GSPLAT_RENDERER_RASTER_CPU_SORT);

    expect(readPlayCanvasRendererRuntimeInfo(application)).toEqual({
      gaussianSort: "cpu",
      graphicsBackend: "webgl2",
      splatCentersEnabled: true,
      xrFixedFoveation: null,
    });
  });

  it("reports WebGPU XR as unavailable when XRGPUBinding is missing", async () => {
    vi.stubGlobal("navigator", {
      xr: { isSessionSupported: vi.fn(async () => true) },
    });
    vi.stubGlobal("XRGPUBinding", undefined);

    await expect(queryPlayCanvasImmersiveVrSupport("webgpu")).resolves.toEqual({
      available: false,
      backendCompatible: false,
      reason: "webgpu-binding-unavailable",
      sessionSupported: true,
    });
  });

  it("reports WebGL2 XR as available when immersive-vr is supported", async () => {
    vi.stubGlobal("navigator", {
      xr: { isSessionSupported: vi.fn(async () => true) },
    });

    await expect(queryPlayCanvasImmersiveVrSupport("webgl2")).resolves.toEqual({
      available: true,
      backendCompatible: true,
      reason: "available",
      sessionSupported: true,
    });
  });

  it("reports browser XR unavailability before backend compatibility", async () => {
    vi.stubGlobal("navigator", {});

    await expect(queryPlayCanvasImmersiveVrSupport("webgpu")).resolves.toEqual({
      available: false,
      backendCompatible: false,
      reason: "navigator-unavailable",
      sessionSupported: false,
    });
  });
});
