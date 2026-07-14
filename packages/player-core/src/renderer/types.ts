import type {
  GaussianFrameSource,
  MeshSceneObject,
  StaticSceneObject,
} from "../manifest/types.js";
import type { QualityDecision } from "../quality/types.js";
import type { Transform } from "@6g-path/shared";

export interface FramePreparationOptions {
  signal?: AbortSignal;
  minimumQualityOnly?: boolean;
  onProgress?: RendererLoadProgressCallback;
  targetQualityLevel?: number;
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

export interface RendererObjectHandle {
  id: string;
  kind: RendererObjectKind;
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
  frameTimeMs?: number;
  loadedMeshObjectCount: number;
  loadedStaticObjectCount: number;
  renderedSplatCount?: number;
  renderFramesPerSecond?: number;
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
  setObjectTransform(objectId: string, transform: Transform): void;
  setObjectVisibility(objectId: string, visible: boolean): void;
  releaseObject(objectId: string): void;
  setRenderQuality(decision: QualityDecision): void;
  getMetrics(): RendererMetrics;
  dispose(): void;
}
