import { SPZ_V4_CODEC_ID } from "./header.js";
import { decodeSpzV4Streaming } from "./streaming.js";

import type { SpzDecodeRequest, SpzDecodeResponse } from "./protocol.js";
import type { SpzStreamHeader, SpzStreamingDiagnostics } from "./streaming.js";
import type {
  DecodedGaussianFrame,
  GaussianCoordinateSystem,
} from "@6g-path/gaussian-codec";

const SH_C0 = 0.28209479177387814;
const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SpzDecodeRequest>) => void) | null;
  postMessage(message: SpzDecodeResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = ({ data }) => {
  void decode(data).then(
    ({ diagnostics, frame, outputAllocatedBytes }) => {
      workerScope.postMessage(
        { diagnostics, frame, id: data.id, ok: true, outputAllocatedBytes },
        [
          frame.positions.buffer,
          frame.scales.buffer,
          frame.rotations.buffer,
          frame.alphas.buffer,
          frame.colors.buffer,
          frame.sphericalHarmonics.buffer,
        ],
      );
    },
    (error: unknown) => {
      workerScope.postMessage({ error: errorMessage(error), id: data.id, ok: false });
    },
  );
};

async function decode(request: SpzDecodeRequest): Promise<{
  diagnostics: SpzStreamingDiagnostics;
  frame: DecodedGaussianFrame;
  outputAllocatedBytes: number;
}> {
  const bytes = new Uint8Array(request.bytes);
  let frame: DecodedGaussianFrame | undefined;
  const diagnostics = await decodeSpzV4Streaming(bytes, request.coordinateSystem, {
    onHeader: (header) => {
      frame = createFrame(header, request.coordinateSystem);
    },
    onChunk: (attribute, pointOffset, chunk) => {
      if (frame === undefined) {
        throw new Error("SPZ decoder emitted attributes before its header.");
      }
      copyAttribute(frame, attribute, pointOffset, chunk);
    },
  });
  if (frame === undefined) {
    throw new Error("SPZ v4 decoder completed without a frame header.");
  }
  return { diagnostics, frame, outputAllocatedBytes: decodedFrameByteLength(frame) };
}

function createFrame(
  header: SpzStreamHeader,
  coordinateSystem: GaussianCoordinateSystem,
): DecodedGaussianFrame {
  const shValuesPerSplat = (((header.shDegree + 1) ** 2 - 1) * 3) | 0;
  return {
    alphas: new Float32Array(header.numPoints),
    antialiased: header.antialiased,
    codecId: SPZ_V4_CODEC_ID,
    colors: new Float32Array(header.numPoints * 3),
    coordinateSystem,
    numSplats: header.numPoints,
    positions: new Float32Array(header.numPoints * 3),
    rotations: new Float32Array(header.numPoints * 4),
    scales: new Float32Array(header.numPoints * 3),
    shDegree: header.shDegree,
    sphericalHarmonics: new Float32Array(header.numPoints * shValuesPerSplat),
  };
}

function copyAttribute(
  frame: DecodedGaussianFrame,
  attribute: number,
  pointOffset: number,
  chunk: Float32Array,
): void {
  if (attribute === 0) {
    frame.positions.set(chunk, pointOffset * 3);
    return;
  }
  if (attribute === 1) {
    const target = frame.alphas;
    for (let index = 0; index < chunk.length; index += 1) {
      const value = chunk[index] ?? 0;
      target[pointOffset + index] = 1 / (1 + Math.exp(-value));
    }
    return;
  }
  if (attribute === 2) {
    const target = frame.colors;
    const targetOffset = pointOffset * 3;
    for (let index = 0; index < chunk.length; index += 1) {
      target[targetOffset + index] = 0.5 + SH_C0 * (chunk[index] ?? 0);
    }
    return;
  }
  if (attribute === 3) {
    const target = frame.scales;
    const targetOffset = pointOffset * 3;
    for (let index = 0; index < chunk.length; index += 1) {
      target[targetOffset + index] = Math.exp(chunk[index] ?? 0);
    }
    return;
  }
  if (attribute === 4) {
    frame.rotations.set(chunk, pointOffset * 4);
    return;
  }
  if (attribute === 5) {
    const valuesPerSplat = (((frame.shDegree + 1) ** 2 - 1) * 3) | 0;
    frame.sphericalHarmonics.set(chunk, pointOffset * valuesPerSplat);
    return;
  }
  throw new Error(`SPZ v4 decoder returned unknown attribute ${attribute}.`);
}

function decodedFrameByteLength(frame: DecodedGaussianFrame): number {
  return (
    frame.positions.byteLength +
    frame.scales.byteLength +
    frame.rotations.byteLength +
    frame.alphas.byteLength +
    frame.colors.byteLength +
    frame.sphericalHarmonics.byteLength
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {};
