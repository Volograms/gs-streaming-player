import type {
  GaussianFrameSource,
  MeshSceneObject,
  StaticSceneObject,
} from "../manifest/types.js";
import type { QualityDecision } from "../quality/types.js";
import type { Transform } from "@6g-path/shared";

export interface FramePreparationOptions {
  signal?: AbortSignal;
  /** Stop after the renderer's minimum drawable quality instead of refinement. */
  minimumQualityOnly?: boolean;
  onProgress?: RendererLoadProgressCallback;
  targetQualityLevel?: number;
  /** Local-to-world transform shared by every frame in the dynamic sequence. */
  transform?: Transform;
}

export interface RendererLoadProgress {
  fraction?: number;
  loadedBytes: number;
  objectId: string;
  totalBytes?: number;
  url: string;
}

export type RendererLoadProgressCallback = (progress: RendererLoadProgress) => void;

export interface RendererLoadOptions {
  onProgress?: RendererLoadProgressCallback;
  signal?: AbortSignal;
}

export type RendererObjectKind = "mesh" | "static-splat";
export type RendererResourceKind = "dynamic-frame" | RendererObjectKind;
export type RendererResourceLoadState = "loading" | "ready";

export interface RendererObjectHandle {
  id: string;
  kind: RendererObjectKind;
}

export interface RendererResourceMetrics {
  id: string;
  kind: RendererResourceKind;
  loadedBytes?: number;
  state: RendererResourceLoadState;
  totalBytes?: number;
  url: string;
  visible: boolean;
}

export interface PreparedFrame {
  frameIndex: number;
  sequenceId: string;
  source: GaussianFrameSource;
  qualityLevel: number;
  rendererResource: unknown;
}

export interface RendererMetrics {
  activeFrameIndex?: number;
  failedResourceLoadCount: number;
  frameTimeMs?: number;
  gpuPageCapacity?: number;
  gpuPageCount?: number;
  loadedMeshObjectCount: number;
  loadedStaticObjectCount: number;
  loadingResourceCount: number;
  preparedFrameCount: number;
  renderedSplatCount?: number;
  renderFramesPerSecond?: number;
  resources: readonly RendererResourceMetrics[];
}

export interface GaussianRendererAdapter {
  initialise(): Promise<void>;
  loadStaticObject(
    object: StaticSceneObject,
    options?: RendererLoadOptions,
  ): Promise<RendererObjectHandle>;
  loadMesh(
    object: MeshSceneObject,
    options?: RendererLoadOptions,
  ): Promise<RendererObjectHandle>;
  prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame>;
  presentFrame(frame: PreparedFrame): void;
  hideFrame(frame: PreparedFrame): void;
  releaseFrame(frame: PreparedFrame): void;
  /** Enable or suppress enhancement-quality paging for an inactive prepared frame. */
  setFrameRefinement(frame: PreparedFrame, enabled: boolean): void;
  setObjectTransform(objectId: string, transform: Transform): void;
  setObjectVisibility(objectId: string, visible: boolean): void;
  releaseObject(objectId: string): void;
  setRenderQuality(decision: QualityDecision): void;
  getMetrics(): RendererMetrics;
  dispose(): void;
}
