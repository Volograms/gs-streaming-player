import type { Application, Entity } from "playcanvas";

export type PlayCanvasGraphicsBackend = "webgl2" | "webgpu";

export interface PlayCanvasRendererRuntimeInfo {
  readonly graphicsBackend: PlayCanvasGraphicsBackend;
  readonly gaussianSort: "cpu" | "gpu";
  readonly splatCentersEnabled: boolean;
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
   * PlayCanvas's WebGL2 fallback. It also selects GPU sort and disables the
   * CPU-center data used by PlayCanvas's WebGL sort path.
   */
  graphicsBackend?: PlayCanvasGraphicsBackend;
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
   * Resolve presentation only after PlayCanvas reports an up-to-date GSplat sort.
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
