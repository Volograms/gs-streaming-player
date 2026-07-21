import createSpzModule from "./vendor/spz.js";

import type { SpzModule, SpzStreamHeader } from "./vendor/spz.js";
import type { GaussianCoordinateSystem } from "@6g-path/gaussian-codec";

export interface SpzStreamingDiagnostics {
  attributeWriteDurationMs: number;
  inputAllocationDurationMs: number;
  inputCopyDurationMs: number;
  outputAllocationDurationMs: number;
  totalDurationMs: number;
  wasmDecodeDurationMs: number;
}

export interface SpzStreamingSink {
  onChunk(attribute: number, pointOffset: number, chunk: Float32Array): void;
  onHeader(header: Readonly<SpzStreamHeader>): void;
}

const modulePromise = createSpzModule();

/**
 * Shared low-level SPZ v4 streaming decode. Consumers synchronously write each
 * WASM scratch chunk into their own final representation.
 */
export async function decodeSpzV4Streaming(
  bytes: Readonly<Uint8Array>,
  coordinateSystem: GaussianCoordinateSystem,
  sink: SpzStreamingSink,
  now: () => number = () => performance.now(),
): Promise<SpzStreamingDiagnostics> {
  const startedAt = now();
  const spz = await modulePromise;
  const allocationStartedAt = now();
  const pointer = spz._malloc(bytes.byteLength);
  const inputAllocationDurationMs = now() - allocationStartedAt;
  if (bytes.byteLength > 0 && pointer === 0) {
    throw new Error(`SPZ WASM input allocation failed for ${bytes.byteLength} bytes.`);
  }
  let attributeWriteDurationMs = 0;
  let outputAllocationDurationMs = 0;
  try {
    const copyStartedAt = now();
    spz.HEAPU8.set(bytes, pointer);
    const inputCopyDurationMs = now() - copyStartedAt;
    let decodeError: Error | undefined;
    const wasmStartedAt = now();
    spz.loadSpzStreaming(
      pointer,
      bytes.byteLength,
      { to: coordinateSystemValue(spz, coordinateSystem) },
      {
        onHeader: (header) => {
          const callbackStartedAt = now();
          sink.onHeader(header);
          outputAllocationDurationMs += now() - callbackStartedAt;
        },
        onChunk: (attribute, pointOffset, chunk) => {
          const callbackStartedAt = now();
          sink.onChunk(attribute, pointOffset, chunk);
          attributeWriteDurationMs += now() - callbackStartedAt;
        },
        onDone: () => undefined,
        onError: (message) => {
          decodeError = new Error(message);
        },
      },
    );
    const wasmInvocationDurationMs = now() - wasmStartedAt;
    if (decodeError !== undefined) {
      throw decodeError;
    }
    return {
      attributeWriteDurationMs,
      inputAllocationDurationMs,
      inputCopyDurationMs,
      outputAllocationDurationMs,
      totalDurationMs: now() - startedAt,
      wasmDecodeDurationMs: Math.max(
        0,
        wasmInvocationDurationMs -
          attributeWriteDurationMs -
          outputAllocationDurationMs,
      ),
    };
  } finally {
    if (pointer !== 0) {
      spz._free(pointer);
    }
  }
}

function coordinateSystemValue(
  spz: SpzModule,
  coordinateSystem: GaussianCoordinateSystem,
): number {
  return spz.CoordinateSystem[coordinateSystem];
}

export type { SpzStreamHeader } from "./vendor/spz.js";
