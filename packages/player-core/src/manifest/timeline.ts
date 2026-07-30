import type { DynamicGaussianSequence } from "./types.js";

/** Effective duration for one selected dynamic sequence on the manifest timeline. */
export function sequencePlaybackDurationSeconds(
  sequence: Readonly<DynamicGaussianSequence>,
  manifestDurationSeconds?: number,
): number {
  const lastTimestamp = sequence.frames.at(-1)?.timestampSeconds ?? 0;
  const nominalDuration = lastTimestamp + 1 / sequence.frameRate;
  return manifestDurationSeconds === undefined
    ? nominalDuration
    : Math.min(manifestDurationSeconds, nominalDuration);
}

/** Timeline delay from one frame to a later frame, including a loop boundary. */
export function forwardFrameDelaySeconds(
  sequence: Readonly<DynamicGaussianSequence>,
  fromFrameIndex: number,
  toFrameIndex: number,
  loop: boolean,
  durationSeconds = sequencePlaybackDurationSeconds(sequence),
): number {
  const fromTimestamp = sequence.frames[fromFrameIndex]?.timestampSeconds;
  const toTimestamp = sequence.frames[toFrameIndex]?.timestampSeconds;
  if (fromTimestamp === undefined || toTimestamp === undefined) {
    throw new RangeError("Frame timestamp is unavailable for timeline scheduling.");
  }
  if (toFrameIndex >= fromFrameIndex) {
    return Math.max(0, toTimestamp - fromTimestamp);
  }
  return loop ? Math.max(0, durationSeconds - fromTimestamp + toTimestamp) : 0;
}
