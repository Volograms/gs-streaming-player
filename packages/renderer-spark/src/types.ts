import type { SparkRendererRuntime } from "./runtime.js";
import type { SparkFramePacker } from "./SparkFramePackingPool.js";
import type { Camera, Scene, WebGLRenderer } from "three";

export interface SparkRenderTimingSample {
  atMs: number;
  displayCommitIntervalsMs: readonly number[];
  flatFrameCopySamplesMs: readonly number[];
  frameIndex?: number;
  renderCallSamplesMs: readonly number[];
  renderIntervalSamplesMs: readonly number[];
  sortOrderingUploadSamplesMs: readonly number[];
  sortReadbackSamplesMs: readonly number[];
  sortSamplesMs: readonly number[];
  sortWorkerSamplesMs: readonly number[];
  sparkUpdateSamplesMs: readonly number[];
}

export interface SparkRendererAdapterOptions {
  /** Start a Three.js animation loop. Defaults to true for adapter-owned renderers. */
  autoRender?: boolean;
  /** Canvas used when the adapter creates the WebGL renderer. */
  canvas?: HTMLCanvasElement;
  /** Caller-owned camera. A perspective camera is created when omitted. */
  camera?: Camera;
  /** Resize the renderer with its canvas. Defaults to true for adapter-owned renderers. */
  manageResize?: boolean;
  /** Caller-owned packer override. It is not disposed by the adapter. */
  framePacker?: SparkFramePacker;
  /** Persistent Spark packing workers. Defaults to two in browsers. */
  maximumPackingWorkers?: number;
  /** Caller-owned renderer. It is never disposed by the adapter. */
  renderer?: WebGLRenderer;
  /** Runtime factory overrides, primarily for non-WebGL tests and embedding. */
  runtime?: SparkRendererRuntime;
  /** High-frequency render diagnostics; consumers should retain a bounded history. */
  onRenderTiming?(sample: Readonly<SparkRenderTimingSample>): void;
  /** Caller-owned scene. Only adapter-owned children are removed on disposal. */
  scene?: Scene;
}
