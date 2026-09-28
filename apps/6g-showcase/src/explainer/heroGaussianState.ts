import { cueString } from "@6g-path/cue-timeline";

import type { CueTimeline, TimelineState } from "@6g-path/cue-timeline";

type Vec3Tuple = readonly [number, number, number];

/** The single enlarged gaussian that demonstrates its parameters (beat 3). */
export interface HeroGaussianState {
  /** 0 = still a point in the cloud, 1 = at its presentation pose. */
  emergence: number;
  /** Axes gizmo shown while position is explained. */
  gizmo: number;
  /** Hue rotation in turns (0..1 wraps back to the original colour). */
  hueShift: number;
  label: { text: string; visibility: number } | undefined;
  /** Displacement from the presentation pose, in stage metres. */
  offset: Vec3Tuple;
  /** Multiplier on the hero's own opacity. */
  opacity: number;
  /** Per-axis multipliers on the hero's sigma. */
  stretch: Vec3Tuple;
  visibility: number;
}

export type HeroParameter = "color" | "opacity" | "position" | "scale";

const PARAMETERS: readonly HeroParameter[] = ["color", "opacity", "position", "scale"];
/** Radius of the position loop, in stage metres. */
const POSITION_LOOP = 0.9;

/**
 * Each parameter animation is a full cycle that starts and ends at the rest pose, so
 * the state is continuous across cue boundaries and depends only on time.
 */
export function heroGaussianState(
  timeline: CueTimeline,
  state: TimelineState,
): HeroGaussianState {
  const show = state.cues
    .filter(({ cue }) => cue.type === "hero-gaussian.show")
    .reduce((maximum, { envelope }) => Math.max(maximum, envelope), 0);
  const result = {
    emergence: show,
    gizmo: 0,
    hueShift: 0,
    label: undefined as HeroGaussianState["label"],
    offset: [0, 0, 0] as Vec3Tuple,
    opacity: 1,
    stretch: [1, 1, 1] as Vec3Tuple,
    visibility: show,
  };
  for (const { cue, envelope, phase, progress } of state.cues) {
    if (cue.type !== "hero-gaussian.parameter" || phase !== "active") continue;
    const parameter = cue.params.parameter;
    if (!isParameter(parameter)) {
      throw new Error(
        `Cue '${cue.id}' has unknown hero parameter '${String(parameter)}'.`,
      );
    }
    const bump = Math.sin(Math.PI * progress);
    const turn = 2 * Math.PI * progress;
    switch (parameter) {
      case "position":
        result.offset = [
          POSITION_LOOP * Math.sin(turn),
          POSITION_LOOP * 0.5 * (1 - Math.cos(turn)),
          0,
        ];
        result.gizmo = envelope;
        break;
      case "scale":
        result.stretch = [1 + 1.2 * bump, 1 - 0.35 * bump, 1 - 0.35 * bump];
        break;
      case "opacity":
        result.opacity = 1 - 0.85 * bump;
        break;
      case "color":
        result.hueShift = progress;
        break;
    }
    const label = cue.params.label;
    if (typeof label === "string") {
      result.label = { text: cueString(timeline, label), visibility: envelope };
    }
  }
  return result;
}

function isParameter(value: unknown): value is HeroParameter {
  return typeof value === "string" && (PARAMETERS as readonly string[]).includes(value);
}
