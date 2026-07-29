import { describe, expect, it } from "vitest";

import { createStaticSceneTransform } from "./staticSceneTransform.js";

describe("createStaticSceneTransform", () => {
  it("omits the identity transform for absent or invalid configuration", () => {
    expect(createStaticSceneTransform({})).toBeUndefined();
    expect(
      createStaticSceneTransform({
        rotationXDegrees: "not-a-number",
        scale: "not-a-number",
      }),
    ).toBeUndefined();
  });

  it("preserves a signed uniform scale", () => {
    expect(createStaticSceneTransform({ scale: "-2" })).toEqual({
      scale: { x: -2, y: -2, z: -2 },
    });
  });

  it("composes uniform scale with an X-axis rotation in degrees", () => {
    const transform = createStaticSceneTransform({
      rotationXDegrees: "180",
      scale: "-2",
    });

    expect(transform?.scale).toEqual({ x: -2, y: -2, z: -2 });
    expect(transform?.rotation?.w).toBeCloseTo(0);
    expect(transform?.rotation?.x).toBeCloseTo(1);
    expect(transform?.rotation?.y).toBe(0);
    expect(transform?.rotation?.z).toBe(0);
  });
});
