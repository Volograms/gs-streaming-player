import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

const BYTES_PER_SPLAT = 32;
const SH_VALUES_PER_TEXTURE = 16;

export interface BabylonPackedFramePayload {
  numSplats: number;
  shDegree: number;
  sphericalHarmonics: Uint8Array[];
  splatBuffer: ArrayBuffer;
}

/** Converts neutral Gaussian attributes into Babylon's documented `.splat` memory layout. */
export function packDecodedGaussianFrameForBabylon(
  frame: Readonly<DecodedGaussianFrame>,
): BabylonPackedFramePayload {
  validateDecodedGaussianFrame(frame);
  const splatBuffer = new ArrayBuffer(frame.numSplats * BYTES_PER_SPLAT);
  const floats = new Float32Array(splatBuffer);
  const bytes = new Uint8Array(splatBuffer);
  const coefficientCount = (((frame.shDegree + 1) ** 2 - 1) * 3) | 0;
  const sphericalHarmonics = Array.from(
    { length: Math.ceil(coefficientCount / SH_VALUES_PER_TEXTURE) },
    () => {
      const values = new Uint8Array(frame.numSplats * SH_VALUES_PER_TEXTURE);
      values.fill(128);
      return values;
    },
  );

  for (let index = 0; index < frame.numSplats; index += 1) {
    const xyz = index * 3;
    const xyzw = index * 4;
    const floatOffset = index * 8;
    const byteOffset = index * BYTES_PER_SPLAT;
    floats[floatOffset] = frame.positions[xyz] ?? 0;
    floats[floatOffset + 1] = frame.positions[xyz + 1] ?? 0;
    floats[floatOffset + 2] = frame.positions[xyz + 2] ?? 0;
    floats[floatOffset + 3] = frame.scales[xyz] ?? 0;
    floats[floatOffset + 4] = frame.scales[xyz + 1] ?? 0;
    floats[floatOffset + 5] = frame.scales[xyz + 2] ?? 0;
    bytes[byteOffset + 24] = quantiseUnit(frame.colors[xyz] ?? 0);
    bytes[byteOffset + 25] = quantiseUnit(frame.colors[xyz + 1] ?? 0);
    bytes[byteOffset + 26] = quantiseUnit(frame.colors[xyz + 2] ?? 0);
    bytes[byteOffset + 27] = quantiseUnit(frame.alphas[index] ?? 0);

    // Babylon reconstructs XYZW as (bytes 29, 30, 31, -byte 28). Encode the
    // neutral quaternion accordingly so its renderer sees the original rotation.
    bytes[byteOffset + 28] = quantiseSigned(-(frame.rotations[xyzw + 3] ?? 1));
    bytes[byteOffset + 29] = quantiseSigned(frame.rotations[xyzw] ?? 0);
    bytes[byteOffset + 30] = quantiseSigned(frame.rotations[xyzw + 1] ?? 0);
    bytes[byteOffset + 31] = quantiseSigned(frame.rotations[xyzw + 2] ?? 0);

    const shOffset = index * coefficientCount;
    for (let coefficient = 0; coefficient < coefficientCount; coefficient += 1) {
      const texture = sphericalHarmonics[Math.floor(coefficient / 16)];
      if (texture !== undefined) {
        texture[index * 16 + (coefficient % 16)] = quantiseSigned(
          frame.sphericalHarmonics[shOffset + coefficient] ?? 0,
        );
      }
    }
  }

  return {
    numSplats: frame.numSplats,
    shDegree: frame.shDegree,
    sphericalHarmonics,
    splatBuffer,
  };
}

function quantiseUnit(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function quantiseSigned(value: number): number {
  return Math.round(Math.min(1, Math.max(-1, value)) * 127.5 + 127.5);
}

function validateDecodedGaussianFrame(frame: Readonly<DecodedGaussianFrame>): void {
  if (!Number.isInteger(frame.numSplats) || frame.numSplats < 0) {
    throw new RangeError("Decoded frame numSplats must be a non-negative integer.");
  }
  if (!Number.isInteger(frame.shDegree) || frame.shDegree < 0 || frame.shDegree > 3) {
    throw new RangeError("The Babylon adapter supports SH degrees 0 through 3.");
  }
  const shValues = frame.numSplats * (((frame.shDegree + 1) ** 2 - 1) * 3);
  const lengths: ReadonlyArray<readonly [string, number, number]> = [
    ["positions", frame.positions.length, frame.numSplats * 3],
    ["scales", frame.scales.length, frame.numSplats * 3],
    ["rotations", frame.rotations.length, frame.numSplats * 4],
    ["alphas", frame.alphas.length, frame.numSplats],
    ["colors", frame.colors.length, frame.numSplats * 3],
    ["sphericalHarmonics", frame.sphericalHarmonics.length, shValues],
  ];
  for (const [name, actual, expected] of lengths) {
    if (actual !== expected) {
      throw new RangeError(
        `Decoded frame ${name} has ${actual} values; expected ${expected}.`,
      );
    }
  }
}
