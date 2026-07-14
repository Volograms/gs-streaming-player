import type { SparkRendererRuntime } from "./runtime.js";
import type { Camera, Scene, WebGLRenderer } from "three";

export interface SparkRendererAdapterOptions {
  /** Start a Three.js animation loop. Defaults to true for adapter-owned renderers. */
  autoRender?: boolean;
  /** Canvas used when the adapter creates the WebGL renderer. */
  canvas?: HTMLCanvasElement;
  /** Caller-owned camera. A perspective camera is created when omitted. */
  camera?: Camera;
  /** Resize the renderer with its canvas. Defaults to true for adapter-owned renderers. */
  manageResize?: boolean;
  /** Caller-owned renderer. It is never disposed by the adapter. */
  renderer?: WebGLRenderer;
  /** Runtime factory overrides, primarily for non-WebGL tests and embedding. */
  runtime?: SparkRendererRuntime;
  /** Caller-owned scene. Only adapter-owned children are removed on disposal. */
  scene?: Scene;
}
