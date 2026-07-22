import type { Application, Entity } from "playcanvas";

export interface PlayCanvasRendererAdapterOptions {
  /** Caller-owned PlayCanvas application. It is never destroyed by the adapter. */
  application?: Application;
  /** Start the application loop. Defaults to true for adapter-owned applications. */
  autoRender?: boolean;
  /** Canvas used when the adapter creates its application. */
  canvas?: HTMLCanvasElement;
  /** Caller-owned camera entity. It must already have a camera component. */
  cameraEntity?: Entity;
  /** Configure automatic canvas resolution. Defaults to true for adapter-owned applications. */
  manageResize?: boolean;
  now?: () => number;
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
}

export interface PlayCanvasXrStartOptions {
  optionalFeatures?: string[];
}
