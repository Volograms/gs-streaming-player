export interface SparkRendererCapabilities {
  readonly dynamicFramePreparation: boolean;
  readonly meshes: boolean;
  readonly pagedRadStreaming: boolean;
  readonly progressiveLevelOfDetail: boolean;
  readonly rendererAdapterImplemented: boolean;
}

export const sparkRendererCapabilities: SparkRendererCapabilities = Object.freeze({
  dynamicFramePreparation: true,
  meshes: true,
  pagedRadStreaming: true,
  progressiveLevelOfDetail: true,
  rendererAdapterImplemented: true,
});
