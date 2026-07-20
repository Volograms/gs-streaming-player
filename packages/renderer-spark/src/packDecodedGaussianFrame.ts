import { PackedSplats, setPackedSplat, utils } from "@sparkjsdev/spark";

import { SparkRendererStateError } from "./errors.js";

import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface PackedDecodedGaussianFrame {
  durationMs: number;
  packedSplats: PackedSplats;
}

export function packDecodedGaussianFrame(
  frame: Readonly<DecodedGaussianFrame>,
  now: () => number,
): PackedDecodedGaussianFrame {
  validateFrame(frame);
  if (frame.shDegree > 3) {
    throw new SparkRendererStateError(
      `Spark supports at most SH3, but decoded frame uses SH${frame.shDegree}.`,
    );
  }
  const startedAt = now();
  const packedSplats = new PackedSplats({ maxSplats: frame.numSplats });
  const packedArray = packedSplats.ensureSplats(frame.numSplats);
  const sh1 =
    frame.shDegree >= 1 ? packedSplats.ensureSplatsSh(1, frame.numSplats) : undefined;
  const sh2 =
    frame.shDegree >= 2 ? packedSplats.ensureSplatsSh(2, frame.numSplats) : undefined;
  const sh3 =
    frame.shDegree >= 3 ? packedSplats.ensureSplatsSh(3, frame.numSplats) : undefined;
  const sh1Scratch = frame.shDegree >= 1 ? new Float32Array(9) : undefined;
  const sh2Scratch = frame.shDegree >= 2 ? new Float32Array(15) : undefined;
  const sh3Scratch = frame.shDegree >= 3 ? new Float32Array(21) : undefined;
  const shValuesPerSplat = (((frame.shDegree + 1) ** 2 - 1) * 3) | 0;

  for (let index = 0; index < frame.numSplats; index += 1) {
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

  packedSplats.numSplats = frame.numSplats;
  packedSplats.maxSh = frame.shDegree;
  packedSplats.setMaxSh(frame.shDegree);
  packedSplats.needsUpdate = true;
  return { durationMs: now() - startedAt, packedSplats };
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

function validateFrame(frame: Readonly<DecodedGaussianFrame>): void {
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
