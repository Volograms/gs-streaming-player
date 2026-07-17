import type {
  FrameRingBufferSnapshot,
  RendererMetrics,
} from "@6g-path/gaussian-player";

export interface RendererMetricsOverlayProps {
  compressedBuffer?: FrameRingBufferSnapshot["compressedBuffer"];
  metrics: RendererMetrics | undefined;
}

function integer(value: number | undefined): string {
  return value === undefined ? "—" : Math.round(value).toLocaleString();
}

function megabytes(value: number | undefined): string {
  return value === undefined ? "—" : `${(value / 1_000_000).toFixed(0)} MB`;
}

export function RendererMetricsOverlay({
  compressedBuffer,
  metrics,
}: RendererMetricsOverlayProps) {
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
      <div>
        <dt>Byte cache</dt>
        <dd>
          {megabytes(compressedBuffer?.residentBytes)} /{" "}
          {megabytes(compressedBuffer?.capacityBytes)}
        </dd>
      </div>
      <div>
        <dt>Cached</dt>
        <dd>
          {integer(compressedBuffer?.readyFrameCount)} ·{" "}
          {integer(compressedBuffer?.activeFetchCount)} fetch
        </dd>
      </div>
    </dl>
  );
}
