import { describe, expect, it } from "vitest";

import { packDecodedGaussianFrameForBabylon } from "../src/index.js";

import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

function createFrame(): DecodedGaussianFrame {
  return {
    alphas: new Float32Array([0.5]),
    antialiased: false,
    codecId: "test",
    colors: new Float32Array([1, 0.25, 0]),
    coordinateSystem: "RUB",
    numSplats: 1,
    positions: new Float32Array([1, 2, 3]),
    rotations: new Float32Array([0, 0, 0, 1]),
    scales: new Float32Array([0.1, 0.2, 0.3]),
    shDegree: 1,
    sphericalHarmonics: new Float32Array([
      -1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0.75, -0.75,
    ]),
  };
}

describe("packDecodedGaussianFrameForBabylon", () => {
  it("packs neutral attributes into Babylon's 32-byte splat layout", () => {
    const packed = packDecodedGaussianFrameForBabylon(createFrame());
    const floats = new Float32Array(packed.splatBuffer);
    const bytes = new Uint8Array(packed.splatBuffer);

    expect(packed.numSplats).toBe(1);
    expect(packed.shDegree).toBe(1);
    expect([...floats.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(floats[3]).toBeCloseTo(0.1);
    expect(floats[4]).toBeCloseTo(0.2);
    expect(floats[5]).toBeCloseTo(0.3);
    expect([...bytes.slice(24, 28)]).toEqual([255, 64, 0, 128]);
    expect([...bytes.slice(28, 32)]).toEqual([0, 128, 128, 128]);
    expect([...packed.sphericalHarmonics[0]!.slice(0, 9)]).toEqual([
      0, 64, 128, 191, 255, 159, 96, 223, 32,
    ]);
    expect([...packed.sphericalHarmonics[0]!.slice(9)]).toEqual(
      Array.from({ length: 7 }, () => 128),
    );
  });

  it("rejects inconsistent neutral attribute lengths", () => {
    const frame = createFrame();
    frame.positions = new Float32Array(2);
    expect(() => packDecodedGaussianFrameForBabylon(frame)).toThrow(
      /positions has 2 values; expected 3/,
    );
  });
});
