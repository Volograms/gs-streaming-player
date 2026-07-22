import { Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { FromHalfFloat, ToHalfFloat } from "@babylonjs/core/Misc/halfFloat.js";
import { describe, expect, it } from "vitest";

import {
  createHalfFloatTextureStorage,
  packCovariance,
} from "../src/babylonPackedFrame.js";
import { BabylonSpzNativeTextureWriter } from "../src/babylonSpzNativeFrame.js";
import {
  packDecodedGaussianFrameForBabylon,
  packDecodedGaussianFrameForBabylonNativeTextures,
} from "../src/index.js";

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

  it("precomputes Babylon's covariance textures without a main-thread splat expansion", () => {
    const packed = packDecodedGaussianFrameForBabylonNativeTextures(createFrame(), {
      height: 1,
      width: 4,
    });

    expect(packed.numSplats).toBe(1);
    expect(packed.textureSize).toEqual({ height: 1, width: 4 });
    expect([...packed.centers.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(packed.centers[3]).toBeCloseTo(0.36, 6);
    expect(FromHalfFloat(packed.covariancesA[0]!)).toBeCloseTo(1 / 9, 3);
    expect(FromHalfFloat(packed.covariancesA[1]!)).toBe(0);
    expect(FromHalfFloat(packed.covariancesA[3]!)).toBeCloseTo(4 / 9, 3);
    expect(FromHalfFloat(packed.covariancesB[1]!)).toBe(1);
    expect(packed.covariancesA[4]).toBe(ToHalfFloat(0));
    expect([...packed.colors.slice(0, 4)]).toEqual([255, 64, 0, 128]);
    expect(packed.colors[7]).toBe(0);
    expect(packed.boundsMinimum).toEqual([1, 2, 3]);
    expect(packed.boundsMaximum).toEqual([1, 2, 3]);
  });

  it("matches Babylon's rotation-and-scale covariance construction", () => {
    const frame = createFrame();
    frame.rotations = new Float32Array([0.2, -0.3, 0.4, 0.5]);
    frame.scales = new Float32Array([0.12, 0.34, 0.56]);
    const packed = packDecodedGaussianFrameForBabylonNativeTextures(frame, {
      height: 1,
      width: 1,
    });
    const expected = covarianceFromBabylonMatrices(frame);

    expect(packed.centers[3]).toBeCloseTo(expected.factor, 6);
    expect([...packed.covariancesA]).toEqual(expected.covariancesA);
    expect([...packed.covariancesB]).toEqual(expected.covariancesB);
  });

  it("retains Babylon's truncating half-float conversion as the compatibility fallback", () => {
    const centers = new Float32Array(4);
    const covarianceStorageA = createHalfFloatTextureStorage(4, null);
    const covarianceStorageB = createHalfFloatTextureStorage(2, null);

    packCovariance(
      0,
      0,
      0,
      1,
      0.1,
      0.2,
      0.3,
      centers,
      covarianceStorageA.bits,
      covarianceStorageB.bits,
      0,
      covarianceStorageA.nativeValues,
      covarianceStorageB.nativeValues,
    );

    expect(covarianceStorageA.nativeValues).toBeUndefined();
    expect(covarianceStorageA.bits[0]).toBe(ToHalfFloat(1 / 9));
    expect(covarianceStorageA.bits[3]).toBe(ToHalfFloat(4 / 9));
    expect(covarianceStorageB.bits[1]).toBe(ToHalfFloat(1));
  });

  it("keeps native half-float covariance values within one encoded ULP", () => {
    const values = [-1, -0.9, -1 / 9, -0, 0, 1 / 9, 0.9, 1];
    const storage = createHalfFloatTextureStorage(values.length);
    if (storage.nativeValues === undefined) {
      return;
    }

    for (let index = 0; index < values.length; index += 1) {
      const value = values[index] ?? 0;
      storage.nativeValues[index] = value;
      expect(
        Math.abs((storage.bits[index] ?? 0) - ToHalfFloat(value)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("writes streamed SPZ chunks directly into the same native texture layout", () => {
    const positions = new Float32Array([1, 2, 3]);
    const alphaLogits = new Float32Array([0]);
    const colorDc = new Float32Array([0.25, -0.5, 1]);
    const scaleLogs = new Float32Array([Math.log(0.1), Math.log(0.2), Math.log(0.3)]);
    const rotations = new Float32Array([0.2, -0.3, 0.4, 0.5]);
    const sphericalHarmonics = new Float32Array([
      -1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0.75, -0.75,
    ]);
    const neutral: DecodedGaussianFrame = {
      alphas: new Float32Array([0.5]),
      antialiased: false,
      codecId: "spz-v4",
      colors: new Float32Array(
        [...colorDc].map((value) => 0.5 + 0.28209479177387814 * value),
      ),
      coordinateSystem: "RUB",
      numSplats: 1,
      positions,
      rotations,
      scales: new Float32Array([...scaleLogs].map((value) => Math.exp(value))),
      shDegree: 1,
      sphericalHarmonics,
    };
    const expected = packDecodedGaussianFrameForBabylonNativeTextures(neutral, {
      height: 1,
      width: 4,
    });
    const writer = new BabylonSpzNativeTextureWriter(
      { antialiased: false, extensions: [], numPoints: 1, shDegree: 1 },
      { maximumTextureSize: 4, requirePowerOfTwoHeight: false },
    );

    writer.write(0, 0, positions);
    writer.write(1, 0, alphaLogits);
    writer.write(2, 0, colorDc);
    writer.write(3, 0, scaleLogs);
    writer.write(4, 0, rotations);
    writer.write(5, 0, sphericalHarmonics);
    const actual = writer.finish();

    expect(actual.payload.centers).toEqual(expected.centers);
    expect(actual.payload.colors).toEqual(expected.colors);
    expect(actual.payload.covariancesA).toEqual(expected.covariancesA);
    expect(actual.payload.covariancesB).toEqual(expected.covariancesB);
    expect(actual.payload.sphericalHarmonics).toEqual(expected.sphericalHarmonics);
    expect(actual.payload.boundsMinimum).toEqual(expected.boundsMinimum);
    expect(actual.payload.boundsMaximum).toEqual(expected.boundsMaximum);
    expect(actual.temporaryAllocatedBytes).toBe(3 * Float32Array.BYTES_PER_ELEMENT);
    expect(actual.outputAllocatedBytes).toBe(192);
  });
});

function covarianceFromBabylonMatrices(frame: DecodedGaussianFrame): {
  covariancesA: number[];
  covariancesB: number[];
  factor: number;
} {
  const rotation = new Quaternion(
    frame.rotations[0],
    frame.rotations[1],
    frame.rotations[2],
    frame.rotations[3],
  );
  rotation.normalize();
  const rotationMatrix = Matrix.Identity();
  rotation.toRotationMatrix(rotationMatrix);
  const scaleMatrix = Matrix.Identity();
  Matrix.ScalingToRef(
    frame.scales[0]! * 2,
    frame.scales[1]! * 2,
    frame.scales[2]! * 2,
    scaleMatrix,
  );
  const matrix = rotationMatrix.multiply(scaleMatrix).m;
  const entry = (index: number): number => matrix[index] ?? 0;
  const covariances = [
    entry(0) * entry(0) + entry(1) * entry(1) + entry(2) * entry(2),
    entry(0) * entry(4) + entry(1) * entry(5) + entry(2) * entry(6),
    entry(0) * entry(8) + entry(1) * entry(9) + entry(2) * entry(10),
    entry(4) * entry(4) + entry(5) * entry(5) + entry(6) * entry(6),
    entry(4) * entry(8) + entry(5) * entry(9) + entry(6) * entry(10),
    entry(8) * entry(8) + entry(9) * entry(9) + entry(10) * entry(10),
  ];
  const factor = Math.max(...covariances.map(Math.abs));
  return {
    covariancesA: covariances
      .slice(0, 4)
      .map((value) => encodeHalfFloatForRuntime(value / factor)),
    covariancesB: covariances
      .slice(4)
      .map((value) => encodeHalfFloatForRuntime(value / factor)),
    factor,
  };
}

function encodeHalfFloatForRuntime(value: number): number {
  const storage = createHalfFloatTextureStorage(1);
  if (storage.nativeValues === undefined) {
    return ToHalfFloat(value);
  }
  storage.nativeValues[0] = value;
  return storage.bits[0] ?? 0;
}
