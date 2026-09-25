import { presentationTimeSeconds } from "@6g-path/cue-timeline";

export interface PresentedFrameSource {
  /** Playback clock (audio-driven) in media seconds. */
  clockSeconds: number;
  durationSeconds: number;
  /** Frame index currently shown by the renderer. */
  frameIndex: number;
  /** Per-frame media timestamps of the dynamic sequence. */
  frameTimestamps: readonly number[];
}

/** Explainer time for one render, held inside the presenter frame on screen. */
export function explainerTimeSeconds(source: PresentedFrameSource): number {
  const { frameIndex, frameTimestamps } = source;
  const index = Math.min(Math.max(frameIndex, 0), frameTimestamps.length - 1);
  // Frame zero covers the leading interval from timeline zero (see player-core).
  const frameStartSeconds = index === 0 ? 0 : frameTimestamps[index]!;
  const frameEndSeconds = Math.max(
    frameStartSeconds,
    frameTimestamps[index + 1] ?? source.durationSeconds,
  );
  return presentationTimeSeconds({
    clockSeconds: source.clockSeconds,
    frameEndSeconds,
    frameStartSeconds,
  });
}
