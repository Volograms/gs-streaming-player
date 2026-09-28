import { evaluateTimeline, parseCueTimeline } from "@6g-path/cue-timeline";
import { describe, expect, it } from "vitest";

import cues from "../../explainer/cues.json";

import { createProjectionLayout } from "./projectionLayout.js";
import { projectionState } from "./projectionState.js";

import type { SparsePoints } from "./explainerAssets.js";

/** A 5 x 3 grid of points on the plane z = 0, plus one behind the camera. */
function gridPoints(): SparsePoints {
  const positions: number[] = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) positions.push(x - 2, y, (x + y) * 0.1);
  }
  positions.push(0, 0, 50); // behind the camera
  positions.push(40, 1, 0); // outside the frame
  const count = positions.length / 3;
  return {
    colors: new Uint8Array(count * 3).fill(128),
    count,
    positions: new Float32Array(positions),
    scales: new Float32Array(count).fill(0.02),
  };
}

const camera = {
  eye: [0, 1, 10] as const,
  height: 200,
  lookAt: [0, 1, 0] as const,
  verticalFovDegrees: 30,
  width: 300,
};
const screen = { halfHeight: 0.2, halfWidth: 0.3 };

describe("createProjectionLayout", () => {
  it("keeps only points inside the image frame, landing within the screen", () => {
    const layout = createProjectionLayout(gridPoints(), camera, screen);
    expect(layout.count).toBe(15);
    for (let i = 0; i < layout.count; i += 1) {
      expect(Math.abs(layout.targets[i * 2]!)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(layout.targets[i * 2 + 1]!)).toBeLessThanOrEqual(0.2);
    }
  });

  it("lands the point on the optical axis at the screen centre", () => {
    const layout = createProjectionLayout(gridPoints(), camera, screen);
    for (let i = 0; i < layout.count; i += 1) {
      if (layout.starts[i * 3] === 0 && layout.starts[i * 3 + 1] === 1) {
        expect(Math.abs(layout.targets[i * 2]!)).toBeLessThan(0.002);
        expect(Math.abs(layout.targets[i * 2 + 1]!)).toBeLessThan(0.002);
      }
    }
  });

  it("keeps left/right and up/down as seen from the camera", () => {
    const layout = createProjectionLayout(gridPoints(), camera, screen);
    const find = (x: number, y: number) => {
      for (let i = 0; i < layout.count; i += 1) {
        if (layout.starts[i * 3] === x && layout.starts[i * 3 + 1] === y) {
          return [layout.targets[i * 2]!, layout.targets[i * 2 + 1]!];
        }
      }
      throw new Error("missing point");
    };
    const [leftU] = find(-2, 1);
    const [rightU] = find(2, 1);
    const [, lowV] = find(0, 0);
    const [, highV] = find(0, 2);
    expect(rightU).toBeGreaterThan(leftU!);
    expect(highV).toBeGreaterThan(lowV!);
  });

  it("orders splats far to near, as a splat rasteriser blends them", () => {
    const layout = createProjectionLayout(gridPoints(), camera, screen);
    const depths = Array.from(
      { length: layout.count },
      (_, i) => 10 - layout.starts[i * 3 + 2]!,
    );
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
  });
});

describe("projectionState with the talk's cues", () => {
  const timeline = parseCueTimeline(cues);
  const at = (time: number) =>
    projectionState(timeline, evaluateTimeline(timeline, time));

  it("runs across beat 7 with its label", () => {
    expect(at(110).visibility).toBe(0);
    const beat = timeline.cues.find(({ id }) => id === "b7-projection")!;
    const middle = at((beat.startSeconds + beat.endSeconds) / 2);
    expect(middle.visibility).toBe(1);
    expect(middle.progress).toBeCloseTo(0.5, 6);
    expect(middle.label?.text).toBe("Proyección 2D");
    expect(middle.present).toBe(0);
    // The finished image is brought to the front and held to the end of the talk.
    expect(at(130).present).toBe(1);
    expect(at(131.2).visibility).toBe(1);
  });
});
