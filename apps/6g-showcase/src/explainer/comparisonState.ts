import { cueString } from "@6g-path/cue-timeline";

import type { CueTimeline, TimelineState } from "@6g-path/cue-timeline";

/** Beat 4: real photo, current render and error for the highlighted training camera. */
export interface ComparisonState {
  labels: { error: string; photo: string; render: string };
  visibility: number;
}

const NO_LABELS = { error: "", photo: "", render: "" };

export function comparisonState(
  timeline: CueTimeline,
  state: TimelineState,
): ComparisonState {
  const cue = state.cues.find(
    ({ cue: candidate, phase }) =>
      candidate.type === "comparison-panels.show" && phase === "active",
  );
  if (cue === undefined) return { labels: NO_LABELS, visibility: 0 };
  const text = (name: string) => {
    const key = cue.cue.params[name];
    return typeof key === "string" ? cueString(timeline, key) : "";
  };
  return {
    labels: {
      error: text("errorLabel"),
      photo: text("realLabel"),
      render: text("renderLabel"),
    },
    visibility: cue.envelope,
  };
}
