import type { RendererMetrics } from "@6g-path/gaussian-player";
import type { Application, Entity } from "playcanvas";

export type PlayCanvasGraphicsBackend = "webgl2" | "webgpu";
export type PlayCanvasGaussianSortMode = "auto" | "cpu" | "gpu";

export interface PlayCanvasRendererRuntimeInfo {
  readonly graphicsBackend: PlayCanvasGraphicsBackend;
  /** Configured renderer pipeline; GPU sorting is skipped when stochasticAlpha is true. */
  readonly gaussianSort: "cpu" | "gpu";
  readonly splatCentersEnabled: boolean;
  /** Whether the GPU renderer is using sort-free, dithered alpha coverage. */
  readonly stochasticAlpha: boolean;
  /** Active XR layer's accepted fixed-foveation value, or null outside supported XR. */
  readonly xrFixedFoveation: number | null;
}

export type PlayCanvasGpuTimingStatus =
  "disabled" | "ready" | "unsupported" | "waiting";

export interface PlayCanvasGpuTimingDistribution {
  readonly latestMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly sampleCount: number;
}

export interface PlayCanvasGpuPassTiming extends PlayCanvasGpuTimingDistribution {
  readonly name: string;
}

export interface PlayCanvasGpuTimingSnapshot {
  readonly captureFrameCount: number;
  readonly capturedFrameCount: number;
  readonly frameTime?: PlayCanvasGpuTimingDistribution;
  readonly passTimings: readonly PlayCanvasGpuPassTiming[];
  readonly reason?: string;
  readonly sampleIntervalMs: number;
  readonly status: PlayCanvasGpuTimingStatus;
}

export interface PlayCanvasRendererMetrics extends RendererMetrics {
  readonly gpuTimings: PlayCanvasGpuTimingSnapshot;
  readonly sogPreparation?: PlayCanvasSogPreparationMetrics;
}

export interface PlayCanvasSogPreparationMetrics {
  readonly execution: "worker" | "native";
  readonly workerCount: number;
  /** End-to-end preparation including queue, decode, and renderer resource creation. */
  readonly totalDurationMs: number;
  /** Worker path only: renderer resource creation, including any CPU-sort GPU readback wait. */
  readonly resourceDurationMs?: number;
  readonly queueDurationMs?: number;
  /** Worker elapsed time; includes asynchronous browser image decode waits. */
  readonly workerDurationMs?: number;
  readonly imageDecodeDurationMs?: number;
  readonly unpackDurationMs?: number;
  /** Includes input cloning, worker startup, work, and main-thread delivery delay. */
  readonly roundTripDurationMs?: number;
  readonly fallbackReason?: string;
}

export type PlayCanvasXrSupportReason =
  | "available"
  | "navigator-unavailable"
  | "session-unsupported"
  | "webgpu-binding-unavailable"
  | "probe-failed";

export interface PlayCanvasXrSupportInfo {
  readonly available: boolean;
  readonly backendCompatible: boolean;
  readonly reason: PlayCanvasXrSupportReason;
  readonly sessionSupported: boolean;
}

export interface PlayCanvasRendererAdapterOptions {
  /** Caller-owned PlayCanvas application. It is never destroyed by the adapter. */
  application?: Application;
  /** Start the application loop. Defaults to true for adapter-owned applications. */
  autoRender?: boolean;
  /** Canvas used when the adapter creates its application. */
  canvas?: HTMLCanvasElement;
  /** Caller-owned camera entity. It must already have a camera component. */
  cameraEntity?: Entity;
  /**
   * Graphics backend required by the adapter. Defaults to WebGL2 for an
   * adapter-owned application. Caller-owned applications retain their backend
   * and Gaussian renderer settings when this is omitted.
   *
   * WebGPU is strict: initialisation fails instead of silently benchmarking
   * PlayCanvas's WebGL2 fallback.
   */
  graphicsBackend?: PlayCanvasGraphicsBackend;
  /**
   * Gaussian depth-sort implementation. Auto selects GPU sort on WebGPU and CPU
   * sort on WebGL2. CPU sort remains available as an experimental WebGPU option.
   * The GPU renderer skips sorting while stochasticAlpha is enabled.
   */
  gaussianSort?: PlayCanvasGaussianSortMode;
  /**
   * Use sort-free, dithered alpha coverage on the WebGPU GPU renderer. Defaults to
   * false for adapter-owned applications. Caller-owned applications retain their
   * setting when omitted. Ignored by the CPU-sort renderer, including WebGL2.
   */
  stochasticAlpha?: boolean;
  /**
   * Workers for dynamic SOG unpacking and WebP ImageBitmap preparation. Defaults
   * to one; zero uses native PlayCanvas loading for comparisons. Each worker can
   * overlap up to four frame preparations, also bounded by player preparation
   * concurrency. Unsupported worker environments fall back to native loading.
   */
  sogPreparationWorkers?: number;
  /** Configure automatic canvas resolution. Defaults to true for adapter-owned applications. */
  manageResize?: boolean;
  /** Reject projected splats smaller than this screen-space radius. PlayCanvas defaults to 2. */
  minPixelSize?: number;
  /** Reject projected splats below this opacity/area contribution. PlayCanvas defaults to 3. */
  minContribution?: number;
  /** Increase contribution rejection toward the view periphery. PlayCanvas defaults to 0. */
  foveationStrength?: number;
  /** Normalized radius at which peripheral rejection starts. PlayCanvas defaults to 0.3. */
  foveationCenter?: number;
  /** Cull low-opacity splats from the forward pass. PlayCanvas defaults to 1 / 255. */
  alphaClipForward?: number;
  /**
   * WebXR fixed-foveation level from 0 to 1. Applied after an immersive session
   * starts when the browser's XR layer supports fixed foveation.
   */
  xrFixedFoveation?: number;
  /**
   * Interval between low-overhead WebGPU timestamp-query samples. Zero or undefined
   * disables GPU sampling. Values below 250 ms are rejected to protect frame cadence.
   */
  gpuTimingSampleIntervalMs?: number;
  now?: () => number;
  /**
   * Global unified-renderer splat budget. Zero disables budget balancing. Streamed
   * octrees select coarser node LODs to approach this limit; fixed resources cannot
   * be reduced. Defaults to the PlayCanvas scene setting.
   */
  splatBudget?: number;
  /**
   * Pin static streamed-octree nodes to this LOD index. Zero is the finest exported
   * level. PlayCanvas clamps the value to each asset's available LOD range.
   */
  staticLodLevel?: number;
  /**
   * Resolve presentation only after PlayCanvas reports GSplat frame readiness.
   * Set stochasticAlpha to false when a fully sorted capture is required.
   * Defaults to false, matching PlayCanvas's native GSplat flipbook handoff.
   */
  waitForFrameReady?: boolean;
  /** Maximum wait for the optional frame-ready fence. Defaults to 5 seconds. */
  frameReadyTimeoutMs?: number;
}

export interface PlayCanvasRendererContext {
  readonly application: Application;
  readonly cameraEntity: Entity;
  readonly dynamicEntity: Entity;
  getRuntimeInfo(): PlayCanvasRendererRuntimeInfo;
  getXrSupportInfo(): Promise<PlayCanvasXrSupportInfo>;
}

export interface PlayCanvasXrStartOptions {
  optionalFeatures?: string[];
}
