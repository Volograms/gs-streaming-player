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
  targetQualityLevel?: number;
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
  loadedStaticObjectCount: number;
  renderedSplatCount?: number;
  renderFramesPerSecond?: number;
}

export interface GaussianRendererAdapter {
  initialise(): Promise<void>;
  loadStaticObject(
    object: StaticSceneObject,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  loadMesh(object: MeshSceneObject, options?: { signal?: AbortSignal }): Promise<void>;
  prepareFrame(
    sequenceId: string,
    frame: GaussianFrameSource,
    options: FramePreparationOptions,
  ): Promise<PreparedFrame>;
  presentFrame(frame: PreparedFrame): void;
  hideFrame(frame: PreparedFrame): void;
  releaseFrame(frame: PreparedFrame): void;
  setObjectTransform(objectId: string, transform: Transform): void;
  setRenderQuality(decision: QualityDecision): void;
  getMetrics(): RendererMetrics;
  dispose(): void;
}
