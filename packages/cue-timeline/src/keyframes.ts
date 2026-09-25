import { lerp } from "./easing.js";

export interface Keyframe {
  at: number;
  value: number;
}

/**
 * Samples ordered keyframes, holding the first and last values outside their range.
 * "step" holds each value until the next key; "linear" interpolates between keys.
 */
export function sampleKeyframes(
  keyframes: readonly Keyframe[],
  at: number,
  mode: "linear" | "step" = "linear",
): number {
  const index = keyframeIndexAt(keyframes, at);
  const current = keyframes[index]!;
  const next = keyframes[index + 1];
  if (mode === "step" || next === undefined || at <= current.at) return current.value;
  return lerp(current.value, next.value, (at - current.at) / (next.at - current.at));
}

/** Index of the last keyframe at or before `at` (0 before the first key). */
export function keyframeIndexAt(keyframes: readonly Keyframe[], at: number): number {
  if (keyframes.length === 0)
    throw new RangeError("At least one keyframe is required.");
  let low = 0;
  let high = keyframes.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (keyframes[middle]!.at <= at) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function assertOrderedKeyframes(
  keyframes: readonly Keyframe[],
  label: string,
): void {
  if (keyframes.length === 0) throw new Error(`${label} needs at least one keyframe.`);
  keyframes.forEach(({ at, value }, index) => {
    if (!Number.isFinite(at) || !Number.isFinite(value)) {
      throw new Error(`${label}[${index}] must have finite 'at' and 'value'.`);
    }
    if (index > 0 && at <= keyframes[index - 1]!.at) {
      throw new Error(`${label} keyframes must be strictly increasing in 'at'.`);
    }
  });
}
