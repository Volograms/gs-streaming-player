import { cueString, easeInOutCubic, sampleKeyframes } from "@6g-path/cue-timeline";

import { densifyState } from "./densifyState.js";
import { heroGaussianState } from "./heroGaussianState.js";

import type { DensifyState } from "./densifyState.js";
import type { ExplainerAssets } from "./explainerAssets.js";
import type { HeroGaussianState } from "./heroGaussianState.js";
import type { CueState, CueTimeline, TimelineState } from "@6g-path/cue-timeline";

/** Everything the explainer scene draws at one instant; derived from time alone. */
export interface ExplainerFrameState {
  cameras: {
    /** Emphasised single training camera (index into the asset camera list). */
    highlight: { camera: number; visibility: number } | undefined;
    ringVisibility: number;
  };
  cloud: {
    /** 0 = crisp SfM points, 1 = initial gaussians. */
    swell: number;
    visibility: number;
  };
  counters: {
    gaussians: CounterState;
    iteration: CounterState;
  };
  demo: {
    /** 0 on the pedestal, 1 at the close-up pose in front of the presenter. */
    focus: number;
    /** Checkpoint iteration shown, or undefined when the object is hidden. */
    iteration: number | undefined;
    /** Uniform grow factor used by the reveal (0..1). */
    scale: number;
    /** Extra rotation about the stage's vertical axis. */
    yawDegrees: number;
  };
  densify: DensifyState;
  hero: HeroGaussianState;
  stage: { visibility: number };
}

export interface CounterState {
  label: string;
  value: number;
  /** 0..1; 0 means hidden. */
  visibility: number;
}

const DEMO_OBJECT_TYPES = new Set([
  "demo-object.reveal",
  "demo-object.dissolve",
  "training.progress",
]);

export function computeExplainerState(
  timeline: CueTimeline,
  state: TimelineState,
  assets: ExplainerAssets,
): ExplainerFrameState {
  const iterations = assets.checkpoints.map(({ iteration }) => iteration);
  const training = latestStarted(state, "training.progress");
  const trainingIteration =
    training === undefined ? 0 : trainingIterationAt(training, iterations).continuous;
  const gaussians = sampleKeyframes(assets.trainingCounts, trainingIteration);
  const swell = latestStarted(state, "sparse-cloud.swell");
  const highlight = state.cues.find(
    ({ cue, phase }) => cue.type === "camera-ring.highlight" && phase === "active",
  );
  return {
    cameras: {
      highlight:
        highlight === undefined
          ? undefined
          : {
              camera: numberParam(highlight, "camera"),
              visibility: highlight.envelope,
            },
      ringVisibility: maxEnvelope(state, "camera-ring.show"),
    },
    cloud: {
      swell: swell === undefined ? 0 : easeInOutCubic(swell.progress),
      // Dimmed, not hidden, while the hero gaussian is explained in front of it.
      visibility:
        maxEnvelope(state, "sparse-cloud.show") *
        (1 - 0.75 * maxEnvelope(state, "sparse-cloud.dim")),
    },
    counters: {
      gaussians: counter(timeline, state, "counter.gaussians", gaussians),
      iteration: counter(timeline, state, "counter.iteration", trainingIteration),
    },
    demo: {
      ...demoObjectState(state, iterations),
      focus: maxEnvelope(state, "demo-object.focus"),
    },
    densify: densifyState(timeline, state),
    hero: heroGaussianState(timeline, state),
    stage: { visibility: maxEnvelope(state, "stage.show") },
  };
}

/**
 * Walks a training cue through the shipped checkpoints between its from/to iterations,
 * giving each checkpoint an equal share of the cue so early (fast-changing) iterations
 * stay on screen as long as late ones. The counter value moves continuously.
 */
export function trainingIterationAt(
  cue: CueState,
  iterations: readonly number[],
): { checkpoint: number; continuous: number } {
  const from = numberParam(cue, "fromIteration");
  const to = numberParam(cue, "toIteration");
  const steps = iterations.filter((iteration) => iteration >= from && iteration <= to);
  if (steps.length === 0) {
    throw new Error(`Training cue '${cue.cue.id}' covers no shipped checkpoint.`);
  }
  const position = cue.progress * (steps.length - 1);
  const index = Math.min(Math.floor(position), steps.length - 1);
  const current = steps[index]!;
  const next = steps[index + 1] ?? current;
  return {
    checkpoint: current,
    continuous: current + (next - current) * (position - index),
  };
}

function demoObjectState(
  state: TimelineState,
  iterations: readonly number[],
): Omit<ExplainerFrameState["demo"], "focus"> {
  const yawDegrees = state.cues
    .filter(
      ({ cue, phase }) => cue.type === "demo-object.turntable" && phase !== "pending",
    )
    .reduce(
      (sum, cue) =>
        sum + numberParam(cue, "turns") * 360 * easeInOutCubic(cue.progress),
      0,
    );
  const started = state.cues.filter(
    ({ cue, phase }) => DEMO_OBJECT_TYPES.has(cue.type) && phase !== "pending",
  );
  const latest = started.at(-1);
  const hidden = { iteration: undefined, scale: 0, yawDegrees };
  if (latest === undefined) return hidden;

  switch (latest.cue.type) {
    case "demo-object.reveal":
      return {
        iteration: nearestCheckpoint(numberParam(latest, "iteration"), iterations),
        scale: easeInOutCubic(latest.progress),
        yawDegrees,
      };
    case "demo-object.dissolve": {
      // Training in reverse: the model falls back to its initial gaussians (a fog in
      // the right colours), which then gives way to the sparse points it grew from.
      if (latest.phase === "done") return hidden;
      const previous = started.at(-2);
      const shown =
        previous === undefined
          ? iterations.at(-1)!
          : previous.cue.type === "training.progress"
            ? trainingIterationAt(previous, iterations).checkpoint
            : nearestCheckpoint(numberParam(previous, "iteration"), iterations);
      return {
        iteration: latest.progress < 0.45 ? shown : iterations[0]!,
        scale: 1,
        yawDegrees,
      };
    }
    default:
      return {
        iteration: trainingIterationAt(latest, iterations).checkpoint,
        scale: 1,
        yawDegrees,
      };
  }
}

function counter(
  timeline: CueTimeline,
  state: TimelineState,
  type: string,
  value: number,
): CounterState {
  const cue = state.cues.find((candidate) => candidate.cue.type === type);
  const label = cue?.cue.params.label;
  return {
    label: typeof label === "string" ? cueString(timeline, label) : "",
    value: Math.round(value),
    visibility: maxEnvelope(state, type),
  };
}

function latestStarted(state: TimelineState, type: string): CueState | undefined {
  return state.cues
    .filter(({ cue, phase }) => cue.type === type && phase !== "pending")
    .at(-1);
}

function maxEnvelope(state: TimelineState, type: string): number {
  return state.cues.reduce(
    (maximum, { cue, envelope }) =>
      cue.type === type ? Math.max(maximum, envelope) : maximum,
    0,
  );
}

function nearestCheckpoint(target: number, iterations: readonly number[]): number {
  return iterations.reduce((best, iteration) =>
    Math.abs(iteration - target) < Math.abs(best - target) ? iteration : best,
  );
}

function numberParam(state: CueState, name: string): number {
  const value = state.cue.params[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Cue '${state.cue.id}' needs a numeric '${name}' param.`);
  }
  return value;
}
