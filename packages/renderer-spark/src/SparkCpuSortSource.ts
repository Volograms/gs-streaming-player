import type { PackedSplats } from "@sparkjsdev/spark";

export interface SparkCpuSortSource {
  active: Uint8Array;
  centers: Float32Array;
}

const sources = new WeakMap<PackedSplats, SparkCpuSortSource>();

export function registerSparkCpuSortSource(
  packedSplats: PackedSplats,
  source: SparkCpuSortSource,
): void {
  sources.set(packedSplats, source);
}

export function getSparkCpuSortSource(
  packedSplats: PackedSplats,
): SparkCpuSortSource | undefined {
  return sources.get(packedSplats);
}
