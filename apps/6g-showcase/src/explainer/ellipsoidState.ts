import { cueString } from "@6g-path/cue-timeline";

import type { CueTimeline, TimelineState } from "@6g-path/cue-timeline";

/** Beat 6: the final model shown as its own gaussians, drawn as solid ellipsoids. */
export interface EllipsoidState {
  /** 0..1 growth of the ellipsoids about their centres. */
  grow: number;
  label: { text: string; visibility: number } | undefined;
  /** True while the ellipsoids cover the object, so its splat model can be hidden. */
  replacesObject: boolean;
}

/** Growth above which the ellipsoids stand in for the splat model. */
const COVER = 0.75;

export function ellipsoidState(
  timeline: CueTimeline,
  state: TimelineState,
): EllipsoidState {
  const cue = state.cues.find(
    ({ cue: candidate, phase }) =>
      candidate.type === "demo-object.ellipsoid-view" && phase === "active",
  );
  if (cue === undefined) return { grow: 0, label: undefined, replacesObject: false };
  const label = cue.cue.params.label;
  return {
    grow: cue.envelope,
    label:
      typeof label === "string"
        ? { text: cueString(timeline, label), visibility: cue.envelope }
        : undefined,
    replacesObject: cue.envelope >= COVER,
  };
}
