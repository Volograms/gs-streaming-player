import { describe, expect, it } from "vitest";

import {
  createCaptureToThreeTransform,
  withUniformScale,
} from "../src/sceneCoordinates.js";

describe("createCaptureToThreeTransform", () => {
  it("combines uniform scale with the capture-axis correction", () => {
    expect(createCaptureToThreeTransform(1.75)).toEqual({
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 1.75, y: 1.75, z: 1.75 },
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid scale %s",
    (scale) => {
      expect(() => createCaptureToThreeTransform(scale)).toThrow(RangeError);
    },
  );

  it("retains authored position and rotation when replacing scale", () => {
    expect(
      withUniformScale(
        {
          position: { x: 1, y: 2, z: 3 },
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          scale: { x: 3, y: 2, z: 1 },
        },
        0.5,
      ),
    ).toEqual({
      position: { x: 1, y: 2, z: 3 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5, z: 0.5 },
    });
  });

  it("rejects a component scale combined with a matrix transform", () => {
    expect(() =>
      withUniformScale(
        {
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
        },
        2,
      ),
    ).toThrow(/matrix/);
  });
});
