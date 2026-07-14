export interface SparkRendererCapabilities {
  readonly meshes: boolean;
  readonly pagedRadStreaming: boolean;
  readonly progressiveLevelOfDetail: boolean;
  readonly rendererAdapterImplemented: boolean;
}

export const sparkRendererCapabilities: SparkRendererCapabilities = Object.freeze({
  meshes: true,
  pagedRadStreaming: true,
  progressiveLevelOfDetail: true,
  rendererAdapterImplemented: false,
});
