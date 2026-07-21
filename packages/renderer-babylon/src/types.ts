import type { BabylonFramePacker } from "./BabylonFramePackingPool.js";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Engine } from "@babylonjs/core/Engines/engine.js";
import type { Scene } from "@babylonjs/core/scene.js";

export interface BabylonRendererAdapterOptions {
  /** Start Babylon's render loop. Defaults to true for adapter-owned engines. */
  autoRender?: boolean;
  canvas?: HTMLCanvasElement;
  /** Caller-owned camera; an ArcRotateCamera is created when omitted. */
  camera?: Camera;
  /** Caller-owned engine; it is never disposed by the adapter. */
  engine?: Engine;
  framePacker?: BabylonFramePacker;
  manageResize?: boolean;
  maximumPackingWorkers?: number;
  now?: () => number;
  /**
   * Pack frame data into Babylon's texture layout off the render thread and use
   * the experimental direct-texture upload path. Defaults to true.
   */
  useNativeTexturePacking?: boolean;
  /** Decode SPZ v4 directly into Babylon texture arrays. Defaults to true. */
  useFusedSpzPacking?: boolean;
  /** Caller-owned scene; adapter-loaded nodes are still released on disposal. */
  scene?: Scene;
}

export interface BabylonRendererContext {
  readonly camera: Camera;
  readonly engine: Engine;
  readonly orbitCamera: ArcRotateCamera | undefined;
  readonly scene: Scene;
}
