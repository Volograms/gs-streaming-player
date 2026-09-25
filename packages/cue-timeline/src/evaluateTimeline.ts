import { smoothstep } from "./easing.js";

import type { Cue, CueState, CueTimeline, TimelineState } from "./types.js";

/**
 * Evaluates every cue at one media time. The result depends only on the time, so
 * seeking, pausing, looping or restarting cannot leave the explainer in a stale state.
 */
export function evaluateTimeline(
  timeline: CueTimeline,
  timeSeconds: number,
): TimelineState {
  if (!Number.isFinite(timeSeconds)) {
    throw new RangeError("Timeline time must be a finite number of seconds.");
  }
  const cues = timeline.cues.map((cue) => evaluateCue(cue, timeSeconds));
  const byId = new Map(cues.map((state) => [state.cue.id, state]));
  return {
    cues,
    get(id) {
      const state = byId.get(id);
      if (state === undefined) throw new RangeError(`Unknown cue '${id}'.`);
      return state;
    },
    timeSeconds,
  };
}

export function evaluateCue(cue: Cue, timeSeconds: number): CueState {
  const { endSeconds: end, startSeconds: start } = cue;
  const phase = timeSeconds < start ? "pending" : timeSeconds < end ? "active" : "done";
  const progress = Math.min(Math.max((timeSeconds - start) / (end - start), 0), 1);
  let envelope = 0;
  if (phase === "active") {
    const rise = cue.fadeInSeconds > 0 ? (timeSeconds - start) / cue.fadeInSeconds : 1;
    const fall = cue.fadeOutSeconds > 0 ? (end - timeSeconds) / cue.fadeOutSeconds : 1;
    envelope = smoothstep(Math.min(rise, fall, 1));
  }
  return { cue, envelope, phase, progress };
}
