import { setPackedSplat, utils } from "@sparkjsdev/spark";

import { SparkRendererStateError } from "./errors.js";

import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

const SPLAT_TEXTURE_WIDTH = 2_048;
const SPLAT_TEXTURE_MAX_HEIGHT = 2_048;

export interface SparkPackedFramePayload {
  maxSplats: number;
  numSplats: number;
  packedArray: Uint32Array;
  sortActive: Uint8Array;
  sortCenters: Float32Array;
  sh1?: Uint32Array;
  sh2?: Uint32Array;
  sh3?: Uint32Array;
  shDegree: number;
}

/** Pure CPU conversion suitable for either the main thread or a renderer worker. */
export function packDecodedGaussianFramePayload(
  frame: Readonly<DecodedGaussianFrame>,
): SparkPackedFramePayload {
  validateDecodedGaussianFrame(frame);
  const maxSplats = computeSparkTextureCapacity(frame.numSplats);
  const packedArray = new Uint32Array(maxSplats * 4);
  const sh1 = frame.shDegree >= 1 ? new Uint32Array(maxSplats * 2) : undefined;
  const sh2 = frame.shDegree >= 2 ? new Uint32Array(maxSplats * 4) : undefined;
  const sh3 = frame.shDegree >= 3 ? new Uint32Array(maxSplats * 4) : undefined;
  const sh1Scratch = frame.shDegree >= 1 ? new Float32Array(9) : undefined;
  const sh2Scratch = frame.shDegree >= 2 ? new Float32Array(15) : undefined;
  const sh3Scratch = frame.shDegree >= 3 ? new Float32Array(21) : undefined;
  const shValuesPerSplat = (((frame.shDegree + 1) ** 2 - 1) * 3) | 0;
  const sortActive = new Uint8Array(frame.numSplats);

  for (let index = 0; index < frame.numSplats; index += 1) {
    sortActive[index] = (frame.alphas[index] ?? 0) > 0 ? 1 : 0;
    const xyz = index * 3;
    const xyzw = index * 4;
    setPackedSplat(
      packedArray,
      index,
      frame.positions[xyz] ?? 0,
      frame.positions[xyz + 1] ?? 0,
      frame.positions[xyz + 2] ?? 0,
      frame.scales[xyz] ?? 0,
      frame.scales[xyz + 1] ?? 0,
      frame.scales[xyz + 2] ?? 0,
      frame.rotations[xyzw] ?? 0,
      frame.rotations[xyzw + 1] ?? 0,
      frame.rotations[xyzw + 2] ?? 0,
      frame.rotations[xyzw + 3] ?? 1,
      frame.alphas[index] ?? 0,
      frame.colors[xyz] ?? 0,
      frame.colors[xyz + 1] ?? 0,
      frame.colors[xyz + 2] ?? 0,
    );

    const shOffset = index * shValuesPerSplat;
    if (sh1 !== undefined && sh1Scratch !== undefined) {
      copyCoefficients(frame.sphericalHarmonics, shOffset, sh1Scratch);
      utils.encodeSh1Rgb(sh1, index, sh1Scratch);
    }
    if (sh2 !== undefined && sh2Scratch !== undefined) {
      copyCoefficients(frame.sphericalHarmonics, shOffset + 9, sh2Scratch);
      utils.encodeSh2Rgb(sh2, index, sh2Scratch);
    }
    if (sh3 !== undefined && sh3Scratch !== undefined) {
      copyCoefficients(frame.sphericalHarmonics, shOffset + 24, sh3Scratch);
      utils.encodeSh3Rgb(sh3, index, sh3Scratch);
    }
  }

  return {
    maxSplats,
    numSplats: frame.numSplats,
    packedArray,
    sortActive,
    sortCenters: frame.positions,
    ...(sh1 === undefined ? {} : { sh1 }),
    ...(sh2 === undefined ? {} : { sh2 }),
    ...(sh3 === undefined ? {} : { sh3 }),
    shDegree: frame.shDegree,
  };
}

export function validateDecodedGaussianFrame(
  frame: Readonly<DecodedGaussianFrame>,
): void {
  if (!Number.isInteger(frame.numSplats) || frame.numSplats < 0) {
    throw new SparkRendererStateError("Decoded frame numSplats must be non-negative.");
  }
  if (!Number.isInteger(frame.shDegree) || frame.shDegree < 0 || frame.shDegree > 3) {
    throw new SparkRendererStateError(
      `Spark supports SH degrees 0 through 3, but decoded frame uses SH${frame.shDegree}.`,
    );
  }
  const expectedShValues = frame.numSplats * (((frame.shDegree + 1) ** 2 - 1) * 3);
  const lengths: ReadonlyArray<readonly [string, number, number]> = [
    ["positions", frame.positions.length, frame.numSplats * 3],
    ["scales", frame.scales.length, frame.numSplats * 3],
    ["rotations", frame.rotations.length, frame.numSplats * 4],
    ["alphas", frame.alphas.length, frame.numSplats],
    ["colors", frame.colors.length, frame.numSplats * 3],
    ["sphericalHarmonics", frame.sphericalHarmonics.length, expectedShValues],
  ];
  for (const [name, actual, expected] of lengths) {
    if (actual !== expected) {
      throw new SparkRendererStateError(
        `Decoded frame ${name} has ${actual} values; expected ${expected}.`,
      );
    }
  }
}

function computeSparkTextureCapacity(numSplats: number): number {
  const height = Math.max(
    1,
    Math.min(SPLAT_TEXTURE_MAX_HEIGHT, Math.ceil(numSplats / SPLAT_TEXTURE_WIDTH)),
  );
  const depth = Math.max(1, Math.ceil(numSplats / (SPLAT_TEXTURE_WIDTH * height)));
  return SPLAT_TEXTURE_WIDTH * height * depth;
}

function copyCoefficients(
  source: Float32Array,
  sourceOffset: number,
  target: Float32Array,
): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = source[sourceOffset + index] ?? 0;
  }
}
