import { describe, expect, it } from "vitest";

import { parseScenePosition, withScenePosition } from "./scenePosition.js";

describe("scene position", () => {
  it("parses finite offsets and defaults invalid axes to the origin", () => {
    expect(
      parseScenePosition({
        x: "1.5",
        y: "-2",
        z: "not-a-number",
      }),
    ).toEqual({ x: 1.5, y: -2, z: 0 });
  });

  it("adds the offset while preserving authored position, rotation, and scale", () => {
    expect(
      withScenePosition(
        {
          position: { x: 1, y: 2, z: 3 },
          rotation: { w: 0, x: 1, y: 0, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        },
        { x: -4, y: 5, z: 0.5 },
      ),
    ).toEqual({
      position: { x: -3, y: 7, z: 3.5 },
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    });
  });

  it("keeps the original transform when the configured offset is zero", () => {
    const transform = { rotation: { w: 1, x: 0, y: 0, z: 0 } };

    expect(withScenePosition(transform, { x: 0, y: 0, z: 0 })).toBe(transform);
    expect(withScenePosition(undefined, { x: 0, y: 0, z: 0 })).toBeUndefined();
  });

  it("rejects component translation of a matrix transform", () => {
    expect(() =>
      withScenePosition(
        {
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
        { x: 0, y: -1, z: 0 },
      ),
    ).toThrow(RangeError);
  });
});
