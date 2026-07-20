import type { SparkCpuSortSource } from "./SparkCpuSortSource.js";

export interface CpuSortKeyRequest {
  matrixWorld: readonly number[];
  numSplats: number;
  readback: Uint32Array;
  sortRadial: boolean;
  viewDirection: Readonly<{ x: number; y: number; z: number }>;
  viewOrigin: Readonly<{ x: number; y: number; z: number }>;
}

/** Mirrors Spark's positive float32 depth metric without a GPU readback. */
export function fillCpuSortKeys(
  source: Readonly<SparkCpuSortSource>,
  request: Readonly<CpuSortKeyRequest>,
): boolean {
  if (
    request.numSplats !== source.centers.length / 3 ||
    request.numSplats !== source.active.length ||
    request.readback.length < request.numSplats ||
    request.matrixWorld.length !== 16
  ) {
    return false;
  }

  const metrics = new Float32Array(
    request.readback.buffer,
    request.readback.byteOffset,
    request.readback.length,
  );
  const matrix = request.matrixWorld;
  const origin = request.viewOrigin;
  const direction = request.viewDirection;

  for (let index = 0; index < request.numSplats; index += 1) {
    if (source.active[index] === 0) {
      metrics[index] = Number.POSITIVE_INFINITY;
      continue;
    }
    const offset = index * 3;
    const x = source.centers[offset] ?? 0;
    const y = source.centers[offset + 1] ?? 0;
    const z = source.centers[offset + 2] ?? 0;
    const worldX =
      (matrix[0] ?? 1) * x +
      (matrix[4] ?? 0) * y +
      (matrix[8] ?? 0) * z +
      (matrix[12] ?? 0);
    const worldY =
      (matrix[1] ?? 0) * x +
      (matrix[5] ?? 1) * y +
      (matrix[9] ?? 0) * z +
      (matrix[13] ?? 0);
    const worldZ =
      (matrix[2] ?? 0) * x +
      (matrix[6] ?? 0) * y +
      (matrix[10] ?? 1) * z +
      (matrix[14] ?? 0);
    const dx = worldX - origin.x;
    const dy = worldY - origin.y;
    const dz = worldZ - origin.z;
    metrics[index] = request.sortRadial
      ? Math.sqrt(dx * dx + dy * dy + dz * dz)
      : dx * direction.x + dy * direction.y + dz * direction.z + 100;
  }
  return true;
}
