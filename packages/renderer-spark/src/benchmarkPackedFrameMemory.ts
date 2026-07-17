import { PackedSplats } from "@sparkjsdev/spark";

const SH_SEGMENTS = [
  { key: "sh1", level: 1 },
  { key: "sh2", level: 2 },
  { key: "sh3", level: 3 },
] as const;
const DEFAULT_MAXIMUM_CLONED_BYTES = 64_000_000;

export interface PackedFrameBenchmarkDistribution {
  medianMs: number;
  p95Ms: number;
}

export interface PackedFrameMemoryBenchmarkResult {
  bind: PackedFrameBenchmarkDistribution;
  clone: PackedFrameBenchmarkDistribution;
  iterations: number;
  payloadBytes: number;
  snapshotDurationMs: number;
  sphericalHarmonicsDegree: 0 | 1 | 2 | 3;
  splatCount: number;
}

export interface PackedFrameMemoryBenchmarkOptions {
  iterations?: number;
  maximumClonedBytes?: number;
  now?: () => number;
}

interface PayloadSegment {
  key: "packedArray" | (typeof SH_SEGMENTS)[number]["key"];
  length: number;
  offset: number;
}

interface PackedFrameMemorySnapshot {
  buffer: ArrayBuffer;
  encoding?: NonNullable<PackedSplats["splatEncoding"]>;
  segments: readonly PayloadSegment[];
  sphericalHarmonicsDegree: 0 | 1 | 2 | 3;
  splatCount: number;
}

/**
 * Measures the cost floor of a renderer-native frame representation. The temporary
 * contiguous payload deliberately has no header and is never persisted; it exists only
 * to compare byte ownership and zero-copy PackedSplats construction with SPZ decoding.
 */
export function benchmarkPackedFrameMemory(
  source: PackedSplats,
  options: PackedFrameMemoryBenchmarkOptions = {},
): PackedFrameMemoryBenchmarkResult {
  const requestedIterations = options.iterations ?? 8;
  if (
    !Number.isInteger(requestedIterations) ||
    requestedIterations < 1 ||
    requestedIterations > 100
  ) {
    throw new RangeError("Packed frame benchmark iterations must be from 1 to 100.");
  }
  const maximumClonedBytes = options.maximumClonedBytes ?? DEFAULT_MAXIMUM_CLONED_BYTES;
  if (!Number.isFinite(maximumClonedBytes) || maximumClonedBytes < 1) {
    throw new RangeError("Packed frame benchmark clone budget must be positive.");
  }
  const now = options.now ?? (() => performance.now());
  const snapshotStartedAt = now();
  const snapshot = createSnapshot(source);
  const snapshotDurationMs = now() - snapshotStartedAt;
  const iterations = Math.max(
    1,
    Math.min(
      requestedIterations,
      Math.floor(maximumClonedBytes / Math.max(1, snapshot.buffer.byteLength)),
    ),
  );
  const cloneSamples: number[] = [];
  const bindSamples: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cloneStartedAt = now();
    const ownedPayload = snapshot.buffer.slice(0);
    cloneSamples.push(now() - cloneStartedAt);

    const bindStartedAt = now();
    const packed = bindSnapshot(snapshot, ownedPayload);
    bindSamples.push(now() - bindStartedAt);
    packed.dispose();
  }

  return {
    bind: summarise(bindSamples),
    clone: summarise(cloneSamples),
    iterations,
    payloadBytes: snapshot.buffer.byteLength,
    snapshotDurationMs,
    sphericalHarmonicsDegree: snapshot.sphericalHarmonicsDegree,
    splatCount: snapshot.splatCount,
  };
}

function createSnapshot(source: PackedSplats): PackedFrameMemorySnapshot {
  const packedArray = source.packedArray;
  if (packedArray === null) {
    throw new Error("Cannot benchmark PackedSplats without packed splat data.");
  }
  const arrays: Array<{
    key: PayloadSegment["key"];
    value: Uint32Array;
  }> = [{ key: "packedArray", value: packedArray }];
  let sphericalHarmonicsDegree: 0 | 1 | 2 | 3 = 0;
  for (const { key, level } of SH_SEGMENTS) {
    const value = source.extra[key];
    if (!(value instanceof Uint32Array)) {
      break;
    }
    arrays.push({ key, value });
    sphericalHarmonicsDegree = level;
  }

  const payloadBytes = arrays.reduce((total, { value }) => total + value.byteLength, 0);
  const buffer = new ArrayBuffer(payloadBytes);
  const destination = new Uint8Array(buffer);
  const segments: PayloadSegment[] = [];
  let offset = 0;
  for (const { key, value } of arrays) {
    destination.set(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      offset,
    );
    segments.push({ key, length: value.length, offset });
    offset += value.byteLength;
  }

  return {
    buffer,
    ...(source.splatEncoding === undefined
      ? {}
      : { encoding: { ...source.splatEncoding } }),
    segments,
    sphericalHarmonicsDegree,
    splatCount: source.numSplats,
  };
}

function bindSnapshot(
  snapshot: PackedFrameMemorySnapshot,
  buffer: ArrayBuffer,
): PackedSplats {
  const arrays = new Map(
    snapshot.segments.map(({ key, length, offset }) => [
      key,
      new Uint32Array(buffer, offset, length),
    ]),
  );
  const packedArray = arrays.get("packedArray");
  if (packedArray === undefined) {
    throw new Error("Packed frame benchmark snapshot has no base array.");
  }
  const extra: Record<string, Uint32Array> = {};
  for (const { key } of SH_SEGMENTS) {
    const value = arrays.get(key);
    if (value !== undefined) {
      extra[key] = value;
    }
  }
  return new PackedSplats({
    extra,
    numSplats: snapshot.splatCount,
    packedArray,
    ...(snapshot.encoding === undefined
      ? {}
      : { splatEncoding: { ...snapshot.encoding } }),
  });
}

function summarise(samples: readonly number[]): PackedFrameBenchmarkDistribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.ceil((sorted.length - 1) * fraction)] ?? 0;
}
