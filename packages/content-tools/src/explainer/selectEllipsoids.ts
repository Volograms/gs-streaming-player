import type { GaussianCloud } from "./renderGaussians.js";

const SH_C0 = 0.28209479177387814;
/** Floats per ellipsoid: position (3), rotation w,x,y,z (4), sigma (3), colour (3). */
export const ELLIPSOID_STRIDE = 13;
/** Gaussians fainter than this contribute little shape and are skipped. */
const MIN_OPACITY = 0.5;

/**
 * Picks up to `count` of a model's gaussians for an "ellipsoid view": opaque ones only,
 * spread evenly through the model (a deterministic stride, not the largest, so small
 * detail is represented as well as large surfaces). Colours are the SH DC term.
 */
export function selectEllipsoids(cloud: GaussianCloud, count: number): Float32Array {
  const candidates: number[] = [];
  for (let i = 0; i < cloud.count; i += 1) {
    if (cloud.opacities[i]! >= MIN_OPACITY) candidates.push(i);
  }
  const picked =
    candidates.length <= count
      ? candidates
      : Array.from(
          { length: count },
          (_, index) => candidates[Math.floor((index * candidates.length) / count)]!,
        );
  const values = new Float32Array(picked.length * ELLIPSOID_STRIDE);
  picked.forEach((i, order) => {
    const out = order * ELLIPSOID_STRIDE;
    values.set(cloud.positions.subarray(i * 3, i * 3 + 3), out);
    values.set(cloud.rotations.subarray(i * 4, i * 4 + 4), out + 3);
    values.set(cloud.scales.subarray(i * 3, i * 3 + 3), out + 7);
    for (let channel = 0; channel < 3; channel += 1) {
      const colour = 0.5 + SH_C0 * cloud.shDc[i * 3 + channel]!;
      values[out + 10 + channel] = Math.min(Math.max(colour, 0), 1);
    }
  });
  return values;
}
