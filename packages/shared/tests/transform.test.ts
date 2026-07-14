import { describe, expect, it } from "vitest";

import { createIdentityTransform } from "../src/index.js";

describe("createIdentityTransform", () => {
  it("creates a neutral translation, rotation, and scale", () => {
    expect(createIdentityTransform()).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });
});
