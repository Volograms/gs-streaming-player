import { decodeSpzV4Streaming } from "@6g-path/gaussian-codec-spz";

import {
  createHalfFloatTextureStorage,
  createSphericalHarmonics,
  packCovariance,
  quantiseSigned,
  quantiseUnit,
} from "./babylonPackedFrame.js";

import type {
  BabylonHalfFloatTextureStorage,
  BabylonNativeTexturePayload,
  BabylonTextureSize,
} from "./babylonPackedFrame.js";
import type { GaussianCoordinateSystem } from "@6g-path/gaussian-codec";
import type {
  SpzStreamHeader,
  SpzStreamingDiagnostics,
} from "@6g-path/gaussian-codec-spz";

const SH_C0 = 0.28209479177387814;
const SH_VALUES_PER_TEXTURE = 16;

export interface BabylonSpzNativeFrameResult {
  diagnostics: SpzStreamingDiagnostics;
  outputAllocatedBytes: number;
  payload: BabylonNativeTexturePayload;
  temporaryAllocatedBytes: number;
}

export interface BabylonSpzTextureConstraints {
  maximumTextureSize: number;
  requirePowerOfTwoHeight: boolean;
}

/** Decode SPZ chunks directly into Babylon's final texture arrays. */
export async function packSpzV4ForBabylonNativeTextures(
  compressedBytes: Readonly<Uint8Array>,
  coordinateSystem: GaussianCoordinateSystem,
  constraints: Readonly<BabylonSpzTextureConstraints>,
): Promise<BabylonSpzNativeFrameResult> {
  let writer: BabylonSpzNativeTextureWriter | undefined;
  const diagnostics = await decodeSpzV4Streaming(compressedBytes, coordinateSystem, {
    onHeader: (header) => {
      writer = new BabylonSpzNativeTextureWriter(header, constraints);
    },
    onChunk: (attribute, pointOffset, chunk) => {
      if (writer === undefined) {
        throw new Error("SPZ decoder emitted attributes before its header.");
      }
      writer.write(attribute, pointOffset, chunk);
    },
  });
  if (writer === undefined) {
    throw new Error("SPZ v4 decoder completed without a frame header.");
  }
  const result = writer.finish();
  return { diagnostics, ...result };
}

export class BabylonSpzNativeTextureWriter {
  private readonly boundsMaximum: [number, number, number] = [
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  private readonly boundsMinimum: [number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
  ];
  private readonly centers: Float32Array;
  private readonly coefficientCount: number;
  private readonly colors: Uint8Array;
  private readonly covarianceStorageA: BabylonHalfFloatTextureStorage;
  private readonly covarianceStorageB: BabylonHalfFloatTextureStorage;
  private readonly covariancesA: Uint16Array;
  private readonly covariancesB: Uint16Array;
  private readonly scales: Float32Array;
  private readonly sphericalHarmonics: Uint8Array[];
  private readonly textureSize: BabylonTextureSize;

  constructor(
    private readonly header: Readonly<SpzStreamHeader>,
    constraints: Readonly<BabylonSpzTextureConstraints>,
  ) {
    if (
      !Number.isInteger(constraints.maximumTextureSize) ||
      constraints.maximumTextureSize <= 0
    ) {
      throw new RangeError("maximumTextureSize must be a positive integer.");
    }
    this.textureSize = textureSizeFor(header.numPoints, constraints);
    const textureLength = this.textureSize.width * this.textureSize.height;
    this.centers = new Float32Array(textureLength * 4);
    this.covarianceStorageA = createHalfFloatTextureStorage(textureLength * 4);
    this.covarianceStorageB = createHalfFloatTextureStorage(textureLength * 2);
    this.covariancesA = this.covarianceStorageA.bits;
    this.covariancesB = this.covarianceStorageB.bits;
    this.colors = new Uint8Array(textureLength * 4);
    this.scales = new Float32Array(header.numPoints * 3);
    this.coefficientCount = (((header.shDegree + 1) ** 2 - 1) * 3) | 0;
    this.sphericalHarmonics = createSphericalHarmonics(
      header.numPoints,
      this.coefficientCount,
      textureLength,
    );
  }

  finish(): Omit<BabylonSpzNativeFrameResult, "diagnostics"> {
    const payload: BabylonNativeTexturePayload = {
      boundsMaximum: this.header.numPoints === 0 ? [0, 0, 0] : this.boundsMaximum,
      boundsMinimum: this.header.numPoints === 0 ? [0, 0, 0] : this.boundsMinimum,
      centers: this.centers,
      colors: this.colors,
      covariancesA: this.covariancesA,
      covariancesB: this.covariancesB,
      numSplats: this.header.numPoints,
      shDegree: this.header.shDegree,
      sphericalHarmonics: this.sphericalHarmonics,
      textureSize: this.textureSize,
    };
    return {
      outputAllocatedBytes: nativePayloadByteLength(payload),
      payload,
      temporaryAllocatedBytes: this.scales.byteLength,
    };
  }

  write(attribute: number, pointOffset: number, chunk: Float32Array): void {
    if (attribute === 0) {
      this.writePositions(pointOffset, chunk);
    } else if (attribute === 1) {
      this.writeAlphas(pointOffset, chunk);
    } else if (attribute === 2) {
      this.writeColors(pointOffset, chunk);
    } else if (attribute === 3) {
      this.writeScales(pointOffset, chunk);
    } else if (attribute === 4) {
      this.writeRotations(pointOffset, chunk);
    } else if (attribute === 5) {
      this.writeSphericalHarmonics(pointOffset, chunk);
    } else {
      throw new Error(`SPZ v4 decoder returned unknown attribute ${attribute}.`);
    }
  }

  private writePositions(pointOffset: number, chunk: Float32Array): void {
    const pointCount = chunk.length / 3;
    for (let localPoint = 0; localPoint < pointCount; localPoint += 1) {
      const source = localPoint * 3;
      const target = (pointOffset + localPoint) * 4;
      const x = chunk[source] ?? 0;
      const y = chunk[source + 1] ?? 0;
      const z = chunk[source + 2] ?? 0;
      this.centers[target] = x;
      this.centers[target + 1] = y;
      this.centers[target + 2] = z;
      this.boundsMinimum[0] = Math.min(this.boundsMinimum[0], x);
      this.boundsMinimum[1] = Math.min(this.boundsMinimum[1], y);
      this.boundsMinimum[2] = Math.min(this.boundsMinimum[2], z);
      this.boundsMaximum[0] = Math.max(this.boundsMaximum[0], x);
      this.boundsMaximum[1] = Math.max(this.boundsMaximum[1], y);
      this.boundsMaximum[2] = Math.max(this.boundsMaximum[2], z);
    }
  }

  private writeAlphas(pointOffset: number, chunk: Float32Array): void {
    for (let index = 0; index < chunk.length; index += 1) {
      const alpha = 1 / (1 + Math.exp(-(chunk[index] ?? 0)));
      this.colors[(pointOffset + index) * 4 + 3] = quantiseUnit(alpha);
    }
  }

  private writeColors(pointOffset: number, chunk: Float32Array): void {
    const targetOffset = pointOffset * 4;
    for (let index = 0; index < chunk.length; index += 1) {
      const point = (index / 3) | 0;
      const component = index % 3;
      this.colors[targetOffset + point * 4 + component] = quantiseUnit(
        0.5 + SH_C0 * (chunk[index] ?? 0),
      );
    }
  }

  private writeScales(pointOffset: number, chunk: Float32Array): void {
    const targetOffset = pointOffset * 3;
    for (let index = 0; index < chunk.length; index += 1) {
      this.scales[targetOffset + index] = Math.exp(chunk[index] ?? 0);
    }
  }

  private writeRotations(pointOffset: number, chunk: Float32Array): void {
    const pointCount = chunk.length / 4;
    for (let localPoint = 0; localPoint < pointCount; localPoint += 1) {
      const point = pointOffset + localPoint;
      const rotation = localPoint * 4;
      const scale = point * 3;
      packCovariance(
        chunk[rotation] ?? 0,
        chunk[rotation + 1] ?? 0,
        chunk[rotation + 2] ?? 0,
        chunk[rotation + 3] ?? 1,
        this.scales[scale] ?? 0,
        this.scales[scale + 1] ?? 0,
        this.scales[scale + 2] ?? 0,
        this.centers,
        this.covariancesA,
        this.covariancesB,
        point,
        this.covarianceStorageA.nativeValues,
        this.covarianceStorageB.nativeValues,
      );
    }
  }

  private writeSphericalHarmonics(pointOffset: number, chunk: Float32Array): void {
    if (this.coefficientCount === 0) {
      return;
    }
    const firstValue = pointOffset * this.coefficientCount;
    for (let index = 0; index < chunk.length; index += 1) {
      const valueIndex = firstValue + index;
      const point = Math.floor(valueIndex / this.coefficientCount);
      const coefficient = valueIndex % this.coefficientCount;
      const texture =
        this.sphericalHarmonics[Math.floor(coefficient / SH_VALUES_PER_TEXTURE)];
      if (texture !== undefined) {
        texture[point * SH_VALUES_PER_TEXTURE + (coefficient % SH_VALUES_PER_TEXTURE)] =
          quantiseSigned(chunk[index] ?? 0);
      }
    }
  }
}

function textureSizeFor(
  numSplats: number,
  constraints: Readonly<BabylonSpzTextureConstraints>,
): BabylonTextureSize {
  const width = constraints.maximumTextureSize;
  let height = Math.max(1, Math.ceil(numSplats / width));
  if (constraints.requirePowerOfTwoHeight) {
    height = 2 ** Math.ceil(Math.log2(height));
  }
  return { height, width };
}

function nativePayloadByteLength(
  payload: Readonly<BabylonNativeTexturePayload>,
): number {
  return (
    payload.centers.byteLength +
    payload.colors.byteLength +
    payload.covariancesA.byteLength +
    payload.covariancesB.byteLength +
    payload.sphericalHarmonics.reduce((total, values) => total + values.byteLength, 0)
  );
}
