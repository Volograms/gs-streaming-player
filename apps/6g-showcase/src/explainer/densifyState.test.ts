import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";
import { describe, expect, it } from "vitest";

import cues from "../../explainer/cues.json";

import { createDensifyPatch } from "./densifyPatch.js";
import { densifyState } from "./densifyState.js";

const timeline = parseCueTimeline(cues);
const at = (time: number) => densifyState(timeline, evaluateTimeline(timeline, time));
const cue = (id: string) => timeline.cues.find((candidate) => candidate.id === id)!;
const within = (id: string, fraction: number) => {
  const { endSeconds, startSeconds } = cue(id);
  return startSeconds + (endSeconds - startSeconds) * fraction;
};

describe("densifyState with the talk's cues", () => {
  it("shows one patch from the start of densification to the end of pruning", () => {
    expect(at(80).visibility).toBe(0);
    expect(at(within("b5-split", 0.5)).visibility).toBe(1);
    // Between the two steps the patch stays, already split and not yet pruned.
    const between = at((cue("b5-split").endSeconds + cue("b5-prune").startSeconds) / 2);
    expect(between).toMatchObject({
      label: undefined,
      pruneHighlight: 0,
      pruned: 0,
      splitSeparation: 1,
      visibility: 1,
    });
    expect(at(112).visibility).toBe(0);
  });

  it("lights up the worst gaussians, then splits them", () => {
    const lit = at(within("b5-split", 0.2));
    expect(lit.splitHighlight).toBeGreaterThan(0.5);
    expect(lit.splitSeparation).toBe(0);
    expect(lit.label).toEqual({ text: "Densificación", visibility: 1 });
    expect(at(within("b5-split", 0.55)).splitSeparation).toBeCloseTo(0.5, 6);
    expect(at(within("b5-split", 0.9))).toMatchObject({
      splitHighlight: 0,
      splitSeparation: 1,
    });
  });

  it("prunes progressively and keeps the result", () => {
    const marked = at(within("b5-prune", 0.14));
    expect(marked.pruned).toBe(0);
    expect(marked.pruneHighlight).toBe(1);
    const middle = at(within("b5-prune", 0.5));
    expect(middle.label?.text).toBe("Poda");
    expect(middle.pruned).toBeCloseTo(0.5, 6);
    expect(at(cue("b5-prune").endSeconds + 0.2).pruned).toBe(1);
  });
});

describe("createDensifyPatch", () => {
  it("is deterministic and has base, split and faint gaussians", () => {
    const palette = [
      [0.3, 0.7, 0.8],
      [0.9, 0.9, 0.9],
    ] as const;
    const first = createDensifyPatch(palette);
    expect(createDensifyPatch(palette)).toEqual(first);
    const roles = first.gaussians.map(({ role }) => role);
    expect(roles.filter((role) => role === "base")).toHaveLength(36);
    expect(roles.filter((role) => role === "split")).toHaveLength(6);
    expect(first.pruneOrder).toHaveLength(10);
    for (const index of first.pruneOrder) {
      expect(first.gaussians[index]!.role).toBe("faint");
      expect(first.gaussians[index]!.opacity).toBeLessThan(0.35);
    }
  });
});
