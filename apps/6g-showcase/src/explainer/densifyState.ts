import { cueString } from "@6g-path/cue-timeline";

import type { CueState, CueTimeline, TimelineState } from "@6g-path/cue-timeline";

/**
 * Beat 5 on one persistent patch of gaussians: densification (the worst-fitting large
 * gaussians light up and split in two) followed by pruning (faint gaussians vanish one
 * after another). The patch stays between and after the two steps, so the viewer sees
 * the same set change; split and prune results hold once their cue has passed.
 */
export interface DensifyState {
  label: { text: string; visibility: number } | undefined;
  /** 0..1 fraction of the faint gaussians already pruned, applied in pruning order. */
  pruned: number;
  /** 0..1 marking of the faint gaussians as the ones about to be pruned. */
  pruneHighlight: number;
  /** 0..1 emphasis on the gaussians about to split (their error). */
  splitHighlight: number;
  /** 0 = parents, 1 = children fully apart. */
  splitSeparation: number;
  /** Patch visibility. */
  visibility: number;
}

export function densifyState(
  timeline: CueTimeline,
  state: TimelineState,
): DensifyState {
  const split = lastStarted(state, "hero-gaussian.split");
  const prune = lastStarted(state, "hero-gaussian.prune");
  const splitProgress = progressOf(split);
  const active = [split, prune].find((cue) => cue?.phase === "active");
  const label = active?.cue.params.label;
  return {
    label:
      active === undefined || typeof label !== "string"
        ? undefined
        : { text: cueString(timeline, label), visibility: active.envelope },
    // Prune across the middle of its cue, after a moment to read the patch.
    pruned: smoothstep(0.15, 0.85, progressOf(prune)),
    pruneHighlight: smoothstep(0.02, 0.14, progressOf(prune)),
    // Light up, split across the middle, then settle.
    splitHighlight:
      smoothstep(0.05, 0.3, splitProgress) * (1 - smoothstep(0.55, 0.8, splitProgress)),
    splitSeparation: smoothstep(0.35, 0.75, splitProgress),
    visibility: state.cues
      .filter(({ cue }) => cue.type === "densify.show")
      .reduce((maximum, { envelope }) => Math.max(maximum, envelope), 0),
  };
}

/** 0 before the cue, its progress while active, 1 once it has passed. */
function progressOf(cue: CueState | undefined): number {
  if (cue === undefined) return 0;
  return cue.phase === "done" ? 1 : cue.progress;
}

function lastStarted(state: TimelineState, type: string): CueState | undefined {
  return state.cues
    .filter(({ cue, phase }) => cue.type === type && phase !== "pending")
    .at(-1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
