export interface PresentedFrameTiming {
  /** Media time from the playback clock (audio), which runs smoothly between frames. */
  clockSeconds: number;
  /** Media time at which the next frame starts, or the sequence end. */
  frameEndSeconds: number;
  /** Media time at which the frame on screen starts. */
  frameStartSeconds: number;
}

/**
 * The explainer time for one render: the playback clock, held inside the interval of the
 * frame actually on screen. Visuals therefore animate smoothly between presenter frames
 * but can never run ahead of (or lag behind) what the viewer sees, including during
 * buffering stalls and immediately after seeks.
 */
export function presentationTimeSeconds(timing: PresentedFrameTiming): number {
  const { clockSeconds, frameEndSeconds, frameStartSeconds } = timing;
  if (
    !Number.isFinite(clockSeconds) ||
    !Number.isFinite(frameStartSeconds) ||
    !Number.isFinite(frameEndSeconds) ||
    frameEndSeconds < frameStartSeconds
  ) {
    throw new RangeError("Presented frame timing must be finite and ordered.");
  }
  // Stay strictly inside the frame so the time never maps to the following frame.
  const latest = Math.max(frameStartSeconds, frameEndSeconds - 1e-6);
  return Math.min(Math.max(clockSeconds, frameStartSeconds), latest);
}
