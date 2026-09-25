import { describe, expect, it } from "vitest";

import { createIdentityTransform, normalizeRotation } from "../src/index.js";

describe("createIdentityTransform", () => {
  it("creates a neutral translation, rotation, and scale", () => {
    expect(createIdentityTransform()).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });
});

describe("normalizeRotation", () => {
  it.each([undefined, { w: 0, x: 0, y: 0, z: 0 }])(
    "uses identity for missing or zero rotations",
    (rotation) => {
      expect(normalizeRotation(rotation)).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    },
  );

  it.each([0.5, 1e-300, 1e300])(
    "normalizes magnitude %s without mutating input",
    (n) => {
      const rotation = { w: n, x: 0, y: n, z: 0 };
      const normalized = normalizeRotation(rotation);
      expect(normalized.w).toBeCloseTo(Math.SQRT1_2);
      expect(normalized.y).toBeCloseTo(Math.SQRT1_2);
      expect(rotation).toEqual({ w: n, x: 0, y: n, z: 0 });
    },
  );

  it.each([NaN, Infinity, -Infinity])("rejects non-finite components: %s", (w) => {
    expect(() => normalizeRotation({ w, x: 0, y: 0, z: 0 })).toThrow(
      "Transform rotation must contain only finite numbers.",
    );
  });
});
