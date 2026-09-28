import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";
import { describe, expect, it } from "vitest";

import cues from "../../explainer/cues.json";

import { heroGaussianState } from "./heroGaussianState.js";
import { rotateHue } from "./visuals/HeroGaussianView.js";

const timeline = parseCueTimeline(cues);
const at = (time: number) =>
  heroGaussianState(timeline, evaluateTimeline(timeline, time));
const cueStart = (id: string) =>
  timeline.cues.find((cue) => cue.id === id)!.startSeconds;
const cueMiddle = (id: string) => {
  const cue = timeline.cues.find((candidate) => candidate.id === id)!;
  return (cue.startSeconds + cue.endSeconds) / 2;
};

describe("heroGaussianState with the talk's cues", () => {
  it("is hidden outside beat 3 and emerges from the cloud", () => {
    expect(at(38).visibility).toBe(0);
    const emerging = at(cueStart("b3-hero") + 1);
    expect(emerging.emergence).toBeGreaterThan(0);
    expect(emerging.emergence).toBeLessThan(1);
    expect(at(66).visibility).toBe(0);
  });

  it("rests at its presentation pose between parameter beats", () => {
    expect(at(48)).toEqual({
      emergence: 1,
      gizmo: 0,
      hueShift: 0,
      label: undefined,
      offset: [0, 0, 0],
      opacity: 1,
      stretch: [1, 1, 1],
      visibility: 1,
    });
  });

  it("animates each named parameter with its Spanish label", () => {
    const position = at(cueStart("b3-position") + 0.5);
    expect(position.label?.text).toBe("Posición");
    expect(position.gizmo).toBe(1);
    expect(Math.hypot(...position.offset)).toBeGreaterThan(0.1);

    const scale = at(cueMiddle("b3-scale"));
    expect(scale.label?.text).toBe("Escala");
    expect(scale.stretch[0]).toBeCloseTo(2.2, 6);

    const opacity = at(cueMiddle("b3-opacity"));
    expect(opacity.label?.text).toBe("Opacidad");
    expect(opacity.opacity).toBeCloseTo(0.15, 6);

    const color = at(cueMiddle("b3-color"));
    expect(color.label?.text).toBe("Color");
    expect(color.hueShift).toBeCloseTo(0.5, 6);
  });

  it("returns to the rest pose at the end of every parameter cycle", () => {
    for (const id of ["b3-position", "b3-scale", "b3-opacity"]) {
      const cue = timeline.cues.find((candidate) => candidate.id === id)!;
      const end = at(cue.endSeconds - 1e-6);
      expect(Math.hypot(...end.offset)).toBeLessThan(1e-4);
      expect(end.stretch[0]).toBeCloseTo(1, 4);
      expect(end.opacity).toBeCloseTo(1, 4);
    }
  });
});

describe("rotateHue", () => {
  it("keeps the colour for a full turn and changes it half-way", () => {
    const cyan = [0.25, 0.7, 0.8] as const;
    rotateHue(cyan, 1).forEach((value, index) =>
      expect(value).toBeCloseTo(cyan[index]!, 6),
    );
    const shifted = rotateHue(cyan, 0.5);
    expect(shifted[0]).toBeGreaterThan(shifted[2]);
  });
});
