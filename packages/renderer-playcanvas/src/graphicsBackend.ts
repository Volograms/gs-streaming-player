import {
  GSPLAT_RENDERER_RASTER_CPU_SORT,
  GSPLAT_RENDERER_RASTER_GPU_SORT,
} from "playcanvas";

import type {
  PlayCanvasGraphicsBackend,
  PlayCanvasRendererRuntimeInfo,
  PlayCanvasXrSupportInfo,
} from "./types.js";
import type { Application } from "playcanvas";

export function configurePlayCanvasGraphicsBackend(
  application: Application,
  requestedBackend: PlayCanvasGraphicsBackend,
): PlayCanvasRendererRuntimeInfo {
  const actualBackend = readGraphicsBackend(application);
  if (actualBackend !== requestedBackend) {
    throw new Error(
      `PlayCanvas ${requestedBackend} was requested, but the browser selected ${actualBackend}.`,
    );
  }

  if (requestedBackend === "webgpu") {
    application.scene.gsplat.renderer = GSPLAT_RENDERER_RASTER_GPU_SORT;
    if (application.scene.gsplat.currentRenderer !== GSPLAT_RENDERER_RASTER_GPU_SORT) {
      throw new Error(
        "PlayCanvas WebGPU initialised without its GPU-sort Gaussian renderer.",
      );
    }
    application.scene.gsplatCentersEnabled = false;
  }

  return readPlayCanvasRendererRuntimeInfo(application);
}

export function readPlayCanvasRendererRuntimeInfo(
  application: Application,
): PlayCanvasRendererRuntimeInfo {
  const renderer = application.scene.gsplat.currentRenderer;
  if (
    renderer !== GSPLAT_RENDERER_RASTER_CPU_SORT &&
    renderer !== GSPLAT_RENDERER_RASTER_GPU_SORT
  ) {
    throw new Error(`Unsupported PlayCanvas Gaussian renderer mode '${renderer}'.`);
  }
  return {
    gaussianSort: renderer === GSPLAT_RENDERER_RASTER_GPU_SORT ? "gpu" : "cpu",
    graphicsBackend: readGraphicsBackend(application),
    splatCentersEnabled: application.scene.gsplatCentersEnabled,
  };
}

export async function queryPlayCanvasImmersiveVrSupport(
  graphicsBackend: PlayCanvasGraphicsBackend,
): Promise<PlayCanvasXrSupportInfo> {
  const backendCompatible = isXrBackendCompatible(graphicsBackend);
  const xr = (
    globalThis as unknown as {
      navigator?: {
        xr?: {
          isSessionSupported?: (mode: "immersive-vr") => Promise<boolean>;
        };
      };
    }
  ).navigator?.xr;
  if (typeof xr?.isSessionSupported !== "function") {
    return {
      available: false,
      backendCompatible,
      reason: "navigator-unavailable",
      sessionSupported: false,
    };
  }

  let sessionSupported: boolean;
  try {
    sessionSupported = await xr.isSessionSupported("immersive-vr");
  } catch {
    return {
      available: false,
      backendCompatible,
      reason: "probe-failed",
      sessionSupported: false,
    };
  }

  if (!sessionSupported) {
    return {
      available: false,
      backendCompatible,
      reason: "session-unsupported",
      sessionSupported,
    };
  }

  if (!backendCompatible) {
    return {
      available: false,
      backendCompatible,
      reason: "webgpu-binding-unavailable",
      sessionSupported,
    };
  }

  return {
    available: true,
    backendCompatible,
    reason: "available",
    sessionSupported,
  };
}

function readGraphicsBackend(application: Application): PlayCanvasGraphicsBackend {
  const backend = application.graphicsDevice.deviceType;
  if (backend !== "webgl2" && backend !== "webgpu") {
    throw new Error(`Unsupported PlayCanvas graphics backend '${backend}'.`);
  }
  return backend;
}

function isXrBackendCompatible(graphicsBackend: PlayCanvasGraphicsBackend): boolean {
  return (
    graphicsBackend !== "webgpu" ||
    typeof (globalThis as unknown as { XRGPUBinding?: unknown }).XRGPUBinding !==
      "undefined"
  );
}
