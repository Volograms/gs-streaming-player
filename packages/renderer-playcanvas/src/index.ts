export {
  PLAYCANVAS_SOG_CODEC_ID,
  PlayCanvasGaussianRendererAdapter,
} from "./PlayCanvasGaussianRendererAdapter.js";
export { queryPlayCanvasImmersiveVrSupport } from "./graphicsBackend.js";
export { applyPlayCanvasTransform } from "./transform.js";
// Exposed for renderer-specific integrations which need to feed external XR views
// through PlayCanvas' native stereo rendering path.
export { Mat4, RenderView } from "playcanvas";
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
