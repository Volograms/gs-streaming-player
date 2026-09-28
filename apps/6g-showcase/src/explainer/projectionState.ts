import { cueString } from "@6g-path/cue-timeline";

import type { CueTimeline, TimelineState } from "@6g-path/cue-timeline";

/** Beat 7: gaussians projected onto a 2D screen. */
export interface ProjectionState {
  label: { text: string; visibility: number } | undefined;
  /** 0 at its first place, 1 brought to the front for a closer look. */
  present: number;
  /** 0..1 through the beat; each gaussian's flight is staggered within it. */
  progress: number;
  visibility: number;
}

export function projectionState(
  timeline: CueTimeline,
  state: TimelineState,
): ProjectionState {
  const cue = state.cues.find(
    ({ cue: candidate, phase }) =>
      candidate.type === "projection.show" && phase === "active",
  );
  if (cue === undefined) {
    return { label: undefined, present: 0, progress: 0, visibility: 0 };
  }
  const present = state.cues
    .filter(({ cue: candidate }) => candidate.type === "projection.present")
    .reduce((maximum, { envelope }) => Math.max(maximum, envelope), 0);
  const label = cue.cue.params.label;
  return {
    label:
      typeof label === "string"
        ? { text: cueString(timeline, label), visibility: cue.envelope }
        : undefined,
    present,
    progress: cue.progress,
    visibility: cue.envelope,
  };
}
