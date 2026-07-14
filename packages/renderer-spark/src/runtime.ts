import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { SplatMeshOptions } from "@sparkjsdev/spark";
import type { Camera, WebGLRendererParameters } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

export interface GltfLoaderLike {
  loadAsync(
    url: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Pick<GLTF, "scene">>;
}

export interface ResizeObserverLike {
  disconnect(): void;
  observe(target: Element): void;
}

export interface SparkRendererRuntime {
  createCamera(): Camera;
  createGltfLoader(): GltfLoaderLike;
  createRenderer(parameters: WebGLRendererParameters): WebGLRenderer;
  createResizeObserver(
    callback: ResizeObserverCallback,
  ): ResizeObserverLike | undefined;
  createScene(): Scene;
  createSparkRenderer(renderer: WebGLRenderer): SparkRenderer;
  createSplatMesh(options: SplatMeshOptions): SplatMesh;
  devicePixelRatio(): number;
  now(): number;
}

export const defaultSparkRendererRuntime: SparkRendererRuntime = {
  createCamera() {
    const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
    camera.position.set(0, 0, 1);
    return camera;
  },
  createGltfLoader: () => new GLTFLoader(),
  createRenderer: (parameters) => new WebGLRenderer(parameters),
  createResizeObserver(callback) {
    if (globalThis.ResizeObserver === undefined) {
      return undefined;
    }

    return new globalThis.ResizeObserver(callback);
  },
  createScene: () => new Scene(),
  createSparkRenderer: (renderer) => new SparkRenderer({ renderer }),
  createSplatMesh: (options) => new SplatMesh(options),
  devicePixelRatio: () => globalThis.devicePixelRatio ?? 1,
  now: () => globalThis.performance.now(),
};
