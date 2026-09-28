import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";
import { describe, expect, it } from "vitest";

import cues from "../explainer/cues.json";

describe("explainer cues", () => {
  it("is a valid cue timeline covering the presenter audio", () => {
    const timeline = parseCueTimeline(cues);
    expect(timeline.durationSeconds).toBeCloseTo(132.19, 2);
    expect(evaluateTimeline(timeline, 21).get("b1-reveal").phase).toBe("active");
  });
});
