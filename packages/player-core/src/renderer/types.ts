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
  /** Optional renderer-internal milestones used by diagnostic tooling. */
  onTrace?: RendererFramePreparationTraceCallback;
  targetQualityLevel?: number;
  /** Independently addressable transfer representation selected before preparation. */
  transferQuality?: FrameTransferQuality;
  /** Local-to-world transform shared by every frame in the dynamic sequence. */
  transform?: Transform;
}

export interface FrameTransferQuality {
  /** Content detail represented by this complete asset in the range (0, 1]. */
  detailLevel: number;
  /** Manifest quality-level identifier. */
  level: number;
  /** Fixed assets are complete flat representations; progressive assets refine in place. */
  mode: "fixed" | "progressive";
  /** Expected decoded splat count, when supplied by content metadata. */
  splatCount?: number;
}

export interface FrameQualityTarget {
  /** Renderer-neutral spatial detail target in the range (0, 1]. */
  detailLevel: number;
  /** Optional view-specific floor; use zero when LoD selection should decide the count. */
  minimumSplatCount: number;
}

export type FramePresentationQualityState = "refining" | "root-ready" | "presentable";

export interface FramePresentationQuality {
  /** Detail that has passed the renderer's presentation-readiness checks. */
  achievedDetailLevel?: number;
  demandedPageCount?: number;
  /** Requested detail retained for compatibility; use achievedDetailLevel for gates. */
  detailLevel: number;
  fetchingPageCount?: number;
  loadedBytes?: number;
  maximumSplatCount?: number;
  residentPageCount?: number;
  selectedSplatCount?: number;
  state: FramePresentationQualityState;
  totalBytes?: number;
  uploadPendingPageCount?: number;
  /** Current renderer demand, whether or not it has finished loading. */
  requestedDetailLevel?: number;
}

export type FrameQualityProgressCallback = (
  quality: Readonly<FramePresentationQuality>,
) => void;

export type RendererFramePreparationPhase =
  | "resource-created"
  | "resource-initialized"
  | "flat-decode"
  | "flat-render-fence"
  | "metadata-ready"
  | "chunk-fetch"
  | "chunk-decode"
  | "page-allocation"
  | "gpu-upload"
  | "tree-registration"
  | "tree-update"
  | "tree-traversal"
  | "minimum-renderable";

export interface RendererFramePreparationTraceEvent {
  chunkIndex?: number;
  /** Time since prepareFrame started, measured with the renderer's monotonic clock. */
  elapsedMs: number;
  pageIndex?: number;
  phase: RendererFramePreparationPhase;
  quality?: Readonly<FramePresentationQuality>;
  reusedPage?: boolean;
  /** Duration measured inside the renderer for this individual phase. */
  stageDurationMs?: number;
}

export type RendererFramePreparationTraceCallback = (
  event: Readonly<RendererFramePreparationTraceEvent>,
) => void;

export interface FrameRefinementOptions {
  onProgress?: FrameQualityProgressCallback;
  signal?: AbortSignal;
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
  transferQuality?: FrameTransferQuality;
  rendererResource: unknown;
}

export interface RendererMetrics {
  activeFrameIndex?: number;
  dynamicGpuCapacity?: number;
  dynamicGpuReallocationCount?: number;
  failedResourceLoadCount: number;
  flatFrameCopyTimeMs?: number;
  frameTimeMs?: number;
  gpuPageCapacity?: number;
  gpuPageCount?: number;
  loadedMeshObjectCount: number;
  loadedStaticObjectCount: number;
  loadingResourceCount: number;
  preparedFrameCount: number;
  renderCallTimeMs?: number;
  renderedSplatCount?: number;
  renderFramesPerSecond?: number;
  resources: readonly RendererResourceMetrics[];
  sortTimeMs?: number;
  sparkUpdateTimeMs?: number;
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
  refineFrame(
    frame: PreparedFrame,
    target: FrameQualityTarget,
    options?: FrameRefinementOptions,
  ): Promise<FramePresentationQuality>;
  getFramePresentationQuality(frame: PreparedFrame): FramePresentationQuality;
  /** Enable or suppress enhancement-quality paging for an inactive prepared frame. */
  setFrameRefinement(frame: PreparedFrame, enabled: boolean): void;
  /** Replace the local-to-world transform of an already prepared frame. */
  setFrameTransform(frame: PreparedFrame, transform?: Transform): void;
  setObjectTransform(objectId: string, transform: Transform): void;
  setObjectVisibility(objectId: string, visible: boolean): void;
  releaseObject(objectId: string): void;
  setRenderQuality(decision: QualityDecision): void;
  getMetrics(): RendererMetrics;
  dispose(): void;
}
