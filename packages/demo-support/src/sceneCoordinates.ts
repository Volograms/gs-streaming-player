import type { Transform } from "@6g-path/shared";

/** Converts the current capture fixtures into the demos' right-handed world. */
export const CAPTURE_TO_WORLD_TRANSFORM = Object.freeze({
  rotation: Object.freeze({ w: 0, x: 1, y: 0, z: 0 }),
}) satisfies Transform;

/** Backwards-compatible name used by the original Three.js/Spark demo. */
export const CAPTURE_TO_THREE_TRANSFORM = CAPTURE_TO_WORLD_TRANSFORM;

/** Builds a uniformly scaled capture transform without losing the axis correction. */
export function createCaptureToThreeTransform(uniformScale: number): Transform {
  return withUniformScale(CAPTURE_TO_WORLD_TRANSFORM, uniformScale);
}

/** Replaces component scale while retaining an object's authored position and rotation. */
export function withUniformScale(
  transform: Transform,
  uniformScale: number,
): Transform {
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) {
    throw new RangeError("Scene scale must be a finite number greater than zero.");
  }
  if (transform.matrix !== undefined) {
    throw new RangeError("Uniform component scale cannot be combined with a matrix.");
  }

  return {
    ...transform,
    scale: { x: uniformScale, y: uniformScale, z: uniformScale },
  };
}
