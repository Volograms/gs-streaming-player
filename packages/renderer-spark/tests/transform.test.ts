import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { applyTransform } from "../src/transform.js";

import type { Transform } from "@6g-path/shared";

function transformPoint(transform: Transform): Vector3 {
  const object = new Object3D();
  applyTransform(object, transform);
  return new Vector3(1, 2, 3).applyMatrix4(object.matrixWorld);
}

describe("Spark component transforms", () => {
  it.each([
    { w: 0, x: 0, y: 0.5, z: 0 },
    { w: 0, x: 0, y: 1, z: 0 },
  ])("keeps a Y half-turn free of scaling for %j", (rotation) => {
    const result = transformPoint({ rotation });
    expect(result.x).toBeCloseTo(-1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(-3);
  });

  it("treats an all-zero quaternion as identity", () => {
    const result = transformPoint({ rotation: { w: 0, x: 0, y: 0, z: 0 } });
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(2);
    expect(result.z).toBeCloseTo(3);
  });

  it("scales locally, then rotates, then translates", () => {
    const result = transformPoint({
      position: { x: 10, y: 20, z: 30 },
      rotation: { w: 2, x: 0, y: 2, z: 0 },
      scale: { x: 2, y: 3, z: 4 },
    });
    expect(result.x).toBeCloseTo(22);
    expect(result.y).toBeCloseTo(26);
    expect(result.z).toBeCloseTo(28);
  });
});
