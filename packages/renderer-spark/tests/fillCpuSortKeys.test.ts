import { describe, expect, it } from "vitest";

import { fillCpuSortKeys } from "../src/fillCpuSortKeys.js";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("fillCpuSortKeys", () => {
  it("mirrors Spark radial metrics and excludes inactive splats", () => {
    const readback = new Uint32Array(3);

    expect(
      fillCpuSortKeys(
        {
          active: new Uint8Array([1, 1, 0]),
          centers: new Float32Array([3, 4, 0, 0, 0, 2, 1, 1, 1]),
        },
        {
          matrixWorld: IDENTITY,
          numSplats: 3,
          readback,
          sortRadial: true,
          viewDirection: { x: 0, y: 0, z: -1 },
          viewOrigin: { x: 0, y: 0, z: 0 },
        },
      ),
    ).toBe(true);

    expect(new Float32Array(readback.buffer)).toEqual(
      new Float32Array([5, 2, Number.POSITIVE_INFINITY]),
    );
  });

  it("applies the display transform for directional sorting", () => {
    const readback = new Uint32Array(1);

    expect(
      fillCpuSortKeys(
        { active: new Uint8Array([1]), centers: new Float32Array([1, 2, 3]) },
        {
          matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
          numSplats: 1,
          readback,
          sortRadial: false,
          viewDirection: { x: 0, y: 0, z: 1 },
          viewOrigin: { x: 0, y: 0, z: 3 },
        },
      ),
    ).toBe(true);
    expect(new Float32Array(readback.buffer)[0]).toBe(130);
  });

  it("declines mappings containing another splat source", () => {
    expect(
      fillCpuSortKeys(
        { active: new Uint8Array([1]), centers: new Float32Array([0, 0, 0]) },
        {
          matrixWorld: IDENTITY,
          numSplats: 2,
          readback: new Uint32Array(2),
          sortRadial: true,
          viewDirection: { x: 0, y: 0, z: -1 },
          viewOrigin: { x: 0, y: 0, z: 0 },
        },
      ),
    ).toBe(false);
  });
});
