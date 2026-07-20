import { describe, expect, it } from "vitest";

import {
  createPackedSplatsFromPayload,
  packDecodedGaussianFrame,
} from "../src/packDecodedGaussianFrame.js";
import { packDecodedGaussianFramePayload } from "../src/sparkPackedFrame.js";

describe("packDecodedGaussianFrame", () => {
  it("isolates Spark packing behind the renderer adapter", () => {
    let now = 10;
    const { durationMs, packedSplats } = packDecodedGaussianFrame(
      {
        alphas: new Float32Array([0.75]),
        antialiased: false,
        codecId: "test",
        colors: new Float32Array([0.25, 0.5, 0.75]),
        coordinateSystem: "RUB",
        numSplats: 1,
        positions: new Float32Array([1, 2, 3]),
        rotations: new Float32Array([0, 0, 0, 1]),
        scales: new Float32Array([0.1, 0.2, 0.3]),
        shDegree: 0,
        sphericalHarmonics: new Float32Array(),
      },
      () => {
        now += 2;
        return now;
      },
    );

    expect(durationMs).toBe(2);
    expect(packedSplats.numSplats).toBe(1);
    expect(packedSplats.getNumSh()).toBe(0);
    expect(packedSplats.getSplat(0).center.toArray()).toEqual([1, 2, 3]);
    packedSplats.dispose();
  });

  it("binds worker payload arrays without another attribute copy", () => {
    const payload = packDecodedGaussianFramePayload({
      alphas: new Float32Array([0.75]),
      antialiased: false,
      codecId: "test",
      colors: new Float32Array([0.25, 0.5, 0.75]),
      coordinateSystem: "RUB",
      numSplats: 1,
      positions: new Float32Array([1, 2, 3]),
      rotations: new Float32Array([0, 0, 0, 1]),
      scales: new Float32Array([0.1, 0.2, 0.3]),
      shDegree: 0,
      sphericalHarmonics: new Float32Array(),
    });
    const packedSplats = createPackedSplatsFromPayload(payload);

    expect(payload.maxSplats).toBe(2_048);
    expect(packedSplats.packedArray).toBe(payload.packedArray);
    expect(packedSplats.getSplat(0).center.toArray()).toEqual([1, 2, 3]);
    packedSplats.dispose();
  });
});
