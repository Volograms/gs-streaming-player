import type { RendererMetrics } from "@6g-path/gaussian-player";

export interface RendererMetricsOverlayProps {
  metrics: RendererMetrics | undefined;
}

function integer(value: number | undefined): string {
  return value === undefined ? "—" : Math.round(value).toLocaleString();
}

export function RendererMetricsOverlay({ metrics }: RendererMetricsOverlayProps) {
  return (
    <dl className="renderer-metrics" aria-label="Renderer metrics">
      <div>
        <dt>FPS</dt>
        <dd>{integer(metrics?.renderFramesPerSecond)}</dd>
      </div>
      <div>
        <dt>Splats</dt>
        <dd>{integer(metrics?.renderedSplatCount)}</dd>
      </div>
      <div>
        <dt>GPU pages</dt>
        <dd>
          {integer(metrics?.gpuPageCount)} / {integer(metrics?.gpuPageCapacity)}
        </dd>
      </div>
      <div>
        <dt>Frames</dt>
        <dd>{integer(metrics?.preparedFrameCount)}</dd>
      </div>
      <div>
        <dt>Dynamic cap</dt>
        <dd>{integer(metrics?.dynamicGpuCapacity)}</dd>
      </div>
      <div>
        <dt>Reallocs</dt>
        <dd>{integer(metrics?.dynamicGpuReallocationCount)}</dd>
      </div>
    </dl>
  );
}
