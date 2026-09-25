import { describe, expect, it } from "vitest";

import {
  cueString,
  evaluateTimeline,
  keyframeIndexAt,
  parseCueTimeline,
  presentationTimeSeconds,
  sampleKeyframes,
} from "../src/index.js";

const document = {
  cues: [
    {
      end: 28,
      fadeIn: 1,
      fadeOut: 2,
      id: "reveal",
      params: { checkpoint: 30000 },
      start: 20,
      type: "demo-object.reveal",
    },
    {
      duration: 4,
      id: "position",
      params: { label: "label.position" },
      start: 45,
      type: "hero.parameter",
    },
    { end: 10, id: "stage", start: 0, type: "stage.show" },
  ],
  durationSeconds: 132.2,
  strings: { "label.position": "Posición" },
  version: 1,
};

describe("parseCueTimeline", () => {
  it("normalises timing and orders cues by start", () => {
    const timeline = parseCueTimeline(document);
    expect(timeline.cues.map(({ id }) => id)).toEqual(["stage", "reveal", "position"]);
    expect(timeline.cues[2]).toMatchObject({
      endSeconds: 49,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      startSeconds: 45,
    });
    expect(cueString(timeline, "label.position")).toBe("Posición");
  });

  const withCue = (cue: Record<string, unknown>) => ({
    ...document,
    cues: [{ id: "x", start: 1, end: 2, type: "t", ...cue }],
  });

  it.each([
    [{ ...document, version: 2 }, /version 1/],
    [{ ...document, cues: [...document.cues, document.cues[0]] }, /Duplicate/],
    [withCue({ start: -1 }), /non-negative/],
    [withCue({ end: 1 }), /after its start/],
    [withCue({ duration: 1 }), /not both/],
    [withCue({ end: 200 }), /timeline duration/],
    [withCue({ fadeIn: 0.8, fadeOut: 0.5 }), /longer than the cue/],
    [withCue({ params: { hintLabel: "missing" } }), /unknown string 'missing'/],
    [withCue({ type: "" }), /needs a type/],
  ])("rejects invalid documents (%#)", (value, message) => {
    expect(() => parseCueTimeline(value)).toThrow(message);
  });
});

describe("evaluateTimeline", () => {
  const timeline = parseCueTimeline(document);

  it("reports phase, progress and envelope from time alone", () => {
    expect(evaluateTimeline(timeline, 19.9).get("reveal")).toMatchObject({
      envelope: 0,
      phase: "pending",
      progress: 0,
    });
    const rising = evaluateTimeline(timeline, 20.5).get("reveal");
    expect(rising.phase).toBe("active");
    expect(rising.envelope).toBeCloseTo(0.5, 9);
    expect(evaluateTimeline(timeline, 24).get("reveal")).toMatchObject({
      envelope: 1,
      progress: 0.5,
    });
    expect(evaluateTimeline(timeline, 27).get("reveal").envelope).toBeCloseTo(0.5, 9);
    expect(evaluateTimeline(timeline, 28).get("reveal")).toMatchObject({
      envelope: 0,
      phase: "done",
      progress: 1,
    });
  });

  it("gives the same state after seeking as when playing up to a time", () => {
    const played = [...Array(1322).keys()].map((tenth) =>
      evaluateTimeline(timeline, tenth / 10),
    );
    const seekTimes = [100, 3, 132.1, 20.5, 0, 47.3];
    for (const time of seekTimes) {
      const direct = evaluateTimeline(timeline, time);
      const sequential = played[Math.round(time * 10)]!;
      expect(direct.cues.map(summarise)).toEqual(sequential.cues.map(summarise));
    }
  });

  it("rejects unknown cues and invalid times", () => {
    expect(() => evaluateTimeline(timeline, 1).get("nope")).toThrow(/Unknown cue/);
    expect(() => evaluateTimeline(timeline, Number.NaN)).toThrow(RangeError);
  });
});

describe("keyframes", () => {
  const counts = [
    { at: 0, value: 65102 },
    { at: 2000, value: 105400 },
    { at: 15000, value: 307952 },
    { at: 30000, value: 226785 },
  ];

  it("interpolates linearly and holds outside the range", () => {
    expect(sampleKeyframes(counts, -5)).toBe(65102);
    expect(sampleKeyframes(counts, 1000)).toBe((65102 + 105400) / 2);
    expect(sampleKeyframes(counts, 40000)).toBe(226785);
  });

  it("steps to the last key at or before the position", () => {
    expect(sampleKeyframes(counts, 14999, "step")).toBe(105400);
    expect(sampleKeyframes(counts, 15000, "step")).toBe(307952);
    expect(keyframeIndexAt(counts, 2000)).toBe(1);
  });
});

describe("presentationTimeSeconds", () => {
  const frame = { frameEndSeconds: 10.0334, frameStartSeconds: 10 };

  it("follows the clock within the frame on screen", () => {
    expect(presentationTimeSeconds({ ...frame, clockSeconds: 10.02 })).toBe(10.02);
  });

  it("holds at the displayed frame while the clock runs ahead (stall)", () => {
    expect(presentationTimeSeconds({ ...frame, clockSeconds: 12 })).toBeLessThan(
      10.0334,
    );
    expect(presentationTimeSeconds({ ...frame, clockSeconds: 12 })).toBeGreaterThan(
      10.033,
    );
  });

  it("does not run behind the displayed frame after a seek", () => {
    expect(presentationTimeSeconds({ ...frame, clockSeconds: 3 })).toBe(10);
  });

  it("rejects unordered frame bounds", () => {
    expect(() =>
      presentationTimeSeconds({
        clockSeconds: 1,
        frameEndSeconds: 1,
        frameStartSeconds: 2,
      }),
    ).toThrow(RangeError);
  });
});

function summarise(state: {
  cue: { id: string };
  envelope: number;
  phase: string;
  progress: number;
}) {
  return [state.cue.id, state.phase, state.progress, state.envelope];
}
