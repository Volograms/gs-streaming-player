import { ToHalfFloat } from "@babylonjs/core/Misc/halfFloat.js";

import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

const BYTES_PER_SPLAT = 32;
const SH_VALUES_PER_TEXTURE = 16;

interface Float16ArrayLike {
  readonly buffer: ArrayBuffer;
  readonly length: number;
  [index: number]: number;
}

interface Float16ArrayConstructorLike {
  new (buffer: ArrayBuffer, byteOffset?: number, length?: number): Float16ArrayLike;
}

export interface BabylonHalfFloatTextureStorage {
  bits: Uint16Array;
  nativeValues?: Float16ArrayLike;
}

export interface BabylonPackedFramePayload {
  numSplats: number;
  shDegree: number;
  sphericalHarmonics: Uint8Array[];
  splatBuffer: ArrayBuffer;
}

/** The dimensions Babylon uses for its per-splat GPU textures. */
export interface BabylonTextureSize {
  height: number;
  width: number;
}

/**
 * Babylon's internal GPU-texture representation after it has expanded a 32-byte
 * `.splat` record. Producing this off the render thread lets the adapter avoid
 * repeating the covariance conversion inside `GaussianSplattingMesh.updateDataAsync`.
 */
export interface BabylonNativeTexturePayload {
  boundsMaximum: readonly [number, number, number];
  boundsMinimum: readonly [number, number, number];
  centers: Float32Array;
  colors: Uint8Array;
  covariancesA: Uint16Array;
  covariancesB: Uint16Array;
  numSplats: number;
  shDegree: number;
  sphericalHarmonics: Uint8Array[];
  textureSize: BabylonTextureSize;
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

/**
 * Packs neutral attributes directly into the texture data consumed by Babylon's
 * Gaussian-splat shader. This is deliberately separate from the documented
 * `.splat` packer above: the latter remains the stable fallback while this payload
 * is used by the adapter's experimental fast upload path.
 */
export function packDecodedGaussianFrameForBabylonNativeTextures(
  frame: Readonly<DecodedGaussianFrame>,
  textureSize: Readonly<BabylonTextureSize>,
): BabylonNativeTexturePayload {
  validateDecodedGaussianFrame(frame);
  validateTextureSize(textureSize, frame.numSplats);
  const textureLength = textureSize.width * textureSize.height;
  const centers = new Float32Array(textureLength * 4);
  const covarianceStorageA = createHalfFloatTextureStorage(textureLength * 4);
  const covarianceStorageB = createHalfFloatTextureStorage(textureLength * 2);
  const covariancesA = covarianceStorageA.bits;
  const covariancesB = covarianceStorageB.bits;
  const colors = new Uint8Array(textureLength * 4);
  const coefficientCount = (((frame.shDegree + 1) ** 2 - 1) * 3) | 0;
  const sphericalHarmonics = createSphericalHarmonics(
    frame.numSplats,
    coefficientCount,
    textureLength,
  );
  const boundsMinimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMaximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < frame.numSplats; index += 1) {
    const xyz = index * 3;
    const xyzw = index * 4;
    const centerOffset = index * 4;
    centers[centerOffset] = frame.positions[xyz] ?? 0;
    centers[centerOffset + 1] = frame.positions[xyz + 1] ?? 0;
    centers[centerOffset + 2] = frame.positions[xyz + 2] ?? 0;
    boundsMinimum[0] = Math.min(boundsMinimum[0], centers[centerOffset]!);
    boundsMinimum[1] = Math.min(boundsMinimum[1], centers[centerOffset + 1]!);
    boundsMinimum[2] = Math.min(boundsMinimum[2], centers[centerOffset + 2]!);
    boundsMaximum[0] = Math.max(boundsMaximum[0], centers[centerOffset]!);
    boundsMaximum[1] = Math.max(boundsMaximum[1], centers[centerOffset + 1]!);
    boundsMaximum[2] = Math.max(boundsMaximum[2], centers[centerOffset + 2]!);

    packCovariance(
      frame.rotations[xyzw] ?? 0,
      frame.rotations[xyzw + 1] ?? 0,
      frame.rotations[xyzw + 2] ?? 0,
      frame.rotations[xyzw + 3] ?? 1,
      frame.scales[xyz] ?? 0,
      frame.scales[xyz + 1] ?? 0,
      frame.scales[xyz + 2] ?? 0,
      centers,
      covariancesA,
      covariancesB,
      index,
      covarianceStorageA.nativeValues,
      covarianceStorageB.nativeValues,
    );
    colors[centerOffset] = quantiseUnit(frame.colors[xyz] ?? 0);
    colors[centerOffset + 1] = quantiseUnit(frame.colors[xyz + 1] ?? 0);
    colors[centerOffset + 2] = quantiseUnit(frame.colors[xyz + 2] ?? 0);
    colors[centerOffset + 3] = quantiseUnit(frame.alphas[index] ?? 0);
    packSphericalHarmonics(frame, sphericalHarmonics, coefficientCount, index);
  }

  return {
    boundsMaximum: frame.numSplats === 0 ? [0, 0, 0] : boundsMaximum,
    boundsMinimum: frame.numSplats === 0 ? [0, 0, 0] : boundsMinimum,
    centers,
    colors,
    covariancesA,
    covariancesB,
    numSplats: frame.numSplats,
    shDegree: frame.shDegree,
    sphericalHarmonics,
    textureSize: { ...textureSize },
  };
}

export function quantiseUnit(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

export function quantiseSigned(value: number): number {
  return Math.round(Math.min(1, Math.max(-1, value)) * 127.5 + 127.5);
}

export function createSphericalHarmonics(
  numSplats: number,
  coefficientCount: number,
  textureLength = numSplats,
): Uint8Array[] {
  return Array.from(
    { length: Math.ceil(coefficientCount / SH_VALUES_PER_TEXTURE) },
    () => {
      const values = new Uint8Array(textureLength * SH_VALUES_PER_TEXTURE);
      values.fill(128);
      return values;
    },
  );
}

/**
 * Allocates the Uint16 texture payload and, when available, a native Float16
 * view over the same bytes. Native writes use IEEE nearest-even rounding;
 * Babylon's fallback converter truncates the mantissa instead.
 */
export function createHalfFloatTextureStorage(
  length: number,
  constructor: Float16ArrayConstructorLike | null = resolveFloat16ArrayConstructor(),
): BabylonHalfFloatTextureStorage {
  const bits = new Uint16Array(length);
  if (constructor === null || !(bits.buffer instanceof ArrayBuffer)) {
    return { bits };
  }
  try {
    return {
      bits,
      nativeValues: new constructor(bits.buffer, bits.byteOffset, bits.length),
    };
  } catch {
    return { bits };
  }
}

function packSphericalHarmonics(
  frame: Readonly<DecodedGaussianFrame>,
  sphericalHarmonics: readonly Uint8Array[],
  coefficientCount: number,
  index: number,
): void {
  const shOffset = index * coefficientCount;
  for (let coefficient = 0; coefficient < coefficientCount; coefficient += 1) {
    const texture = sphericalHarmonics[Math.floor(coefficient / SH_VALUES_PER_TEXTURE)];
    if (texture !== undefined) {
      texture[index * SH_VALUES_PER_TEXTURE + (coefficient % SH_VALUES_PER_TEXTURE)] =
        quantiseSigned(frame.sphericalHarmonics[shOffset + coefficient] ?? 0);
    }
  }
}

export function packCovariance(
  initialX: number,
  initialY: number,
  initialZ: number,
  initialW: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  centers: Float32Array,
  covariancesA: Uint16Array,
  covariancesB: Uint16Array,
  index: number,
  covariancesAFloat16?: Float16ArrayLike,
  covariancesBFloat16?: Float16ArrayLike,
): void {
  const length = Math.hypot(initialX, initialY, initialZ, initialW) || 1;
  const x = initialX / length;
  const y = initialY / length;
  const z = initialZ / length;
  const w = initialW / length;
  const sx = scaleX * 2;
  const sy = scaleY * 2;
  const sz = scaleZ * 2;

  // This is the same R * S covariance construction Babylon performs in
  // GaussianSplattingMeshBase._makeSplat, written with scalar arithmetic so it
  // can run efficiently in the packing worker.
  const m0 = (1 - 2 * (y * y + z * z)) * sx;
  const m1 = 2 * (x * y + z * w) * sy;
  const m2 = 2 * (x * z - y * w) * sz;
  const m4 = 2 * (x * y - z * w) * sx;
  const m5 = (1 - 2 * (x * x + z * z)) * sy;
  const m6 = 2 * (y * z + x * w) * sz;
  const m8 = 2 * (x * z + y * w) * sx;
  const m9 = 2 * (y * z - x * w) * sy;
  const m10 = (1 - 2 * (x * x + y * y)) * sz;
  const c0 = m0 * m0 + m1 * m1 + m2 * m2;
  const c1 = m0 * m4 + m1 * m5 + m2 * m6;
  const c2 = m0 * m8 + m1 * m9 + m2 * m10;
  const c3 = m4 * m4 + m5 * m5 + m6 * m6;
  const c4 = m4 * m8 + m5 * m9 + m6 * m10;
  const c5 = m8 * m8 + m9 * m9 + m10 * m10;
  const factor = Math.max(
    Math.abs(c0),
    Math.abs(c1),
    Math.abs(c2),
    Math.abs(c3),
    Math.abs(c4),
    Math.abs(c5),
  );
  const covAOffset = index * 4;
  const covBOffset = index * 2;
  centers[covAOffset + 3] = factor;
  if (covariancesAFloat16 !== undefined && covariancesBFloat16 !== undefined) {
    covariancesAFloat16[covAOffset] = c0 / factor;
    covariancesAFloat16[covAOffset + 1] = c1 / factor;
    covariancesAFloat16[covAOffset + 2] = c2 / factor;
    covariancesAFloat16[covAOffset + 3] = c3 / factor;
    covariancesBFloat16[covBOffset] = c4 / factor;
    covariancesBFloat16[covBOffset + 1] = c5 / factor;
  } else {
    covariancesA[covAOffset] = ToHalfFloat(c0 / factor);
    covariancesA[covAOffset + 1] = ToHalfFloat(c1 / factor);
    covariancesA[covAOffset + 2] = ToHalfFloat(c2 / factor);
    covariancesA[covAOffset + 3] = ToHalfFloat(c3 / factor);
    covariancesB[covBOffset] = ToHalfFloat(c4 / factor);
    covariancesB[covBOffset + 1] = ToHalfFloat(c5 / factor);
  }
}

function resolveFloat16ArrayConstructor(): Float16ArrayConstructorLike | null {
  const constructor = (
    globalThis as typeof globalThis & {
      Float16Array?: Float16ArrayConstructorLike;
    }
  ).Float16Array;
  return typeof constructor === "function" ? constructor : null;
}

function validateTextureSize(
  textureSize: Readonly<BabylonTextureSize>,
  numSplats: number,
): void {
  if (
    !Number.isInteger(textureSize.width) ||
    !Number.isInteger(textureSize.height) ||
    textureSize.width <= 0 ||
    textureSize.height <= 0
  ) {
    throw new RangeError("Babylon texture dimensions must be positive integers.");
  }
  if (textureSize.width * textureSize.height < numSplats) {
    throw new RangeError("Babylon texture dimensions cannot hold every splat.");
  }
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
