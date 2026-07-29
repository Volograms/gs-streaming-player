export {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
} from "./PlayCanvasGaussianRendererAdapter.js";
export { queryPlayCanvasImmersiveVrSupport } from "./graphicsBackend.js";
export { applyPlayCanvasTransform } from "./transform.js";
// Exposed for renderer-specific integrations that build native world-space XR UI.
export { Color, Entity, StandardMaterial, Texture, Vec3 } from "playcanvas";
export type { XrInput, XrInputSource } from "playcanvas";
export type {
  PlayCanvasGraphicsBackend,
  PlayCanvasGaussianSortMode,
  PlayCanvasGpuPassTiming,
  PlayCanvasGpuTimingDistribution,
  PlayCanvasGpuTimingSnapshot,
  PlayCanvasGpuTimingStatus,
  PlayCanvasRendererAdapterOptions,
  PlayCanvasRendererContext,
  PlayCanvasRendererMetrics,
  PlayCanvasRendererRuntimeInfo,
  PlayCanvasXrSupportInfo,
  PlayCanvasXrSupportReason,
  PlayCanvasXrStartOptions,
} from "./types.js";
