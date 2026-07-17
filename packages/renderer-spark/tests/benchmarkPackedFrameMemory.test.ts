import { PackedSplats } from "@sparkjsdev/spark";
import { describe, expect, it } from "vitest";

import { benchmarkPackedFrameMemory } from "../src/index.js";

describe("benchmarkPackedFrameMemory", () => {
  it("benchmarks contiguous base and spherical-harmonics memory without SPZ", () => {
    const packedArray = new Uint32Array(16_384 * 4);
    const sh1 = new Uint32Array(16_384 * 2);
    const source = new PackedSplats({
      extra: { sh1 },
      numSplats: 12_345,
      packedArray,
    });
    let now = 0;

    const result = benchmarkPackedFrameMemory(source, {
      iterations: 3,
      now: () => {
        now += 0.25;
        return now;
      },
    });

    expect(result).toEqual({
      bind: { medianMs: 0.25, p95Ms: 0.25 },
      clone: { medianMs: 0.25, p95Ms: 0.25 },
      iterations: 3,
      payloadBytes: packedArray.byteLength + sh1.byteLength,
      snapshotDurationMs: 0.25,
      sphericalHarmonicsDegree: 1,
      splatCount: 12_345,
    });
  });

  it("rejects missing packed data and unreasonable iteration counts", () => {
    expect(() => benchmarkPackedFrameMemory(new PackedSplats())).toThrow(
      "without packed splat data",
    );
    expect(() =>
      benchmarkPackedFrameMemory(
        new PackedSplats({ packedArray: new Uint32Array(16_384 * 4) }),
        { iterations: 0 },
      ),
    ).toThrow(RangeError);
  });

  it("bounds clone work for large packed payloads", () => {
    const source = new PackedSplats({
      packedArray: new Uint32Array(16_384 * 4),
    });

    const result = benchmarkPackedFrameMemory(source, {
      iterations: 8,
      maximumClonedBytes: source.packedArray?.byteLength ?? 1,
    });

    expect(result.iterations).toBe(1);
  });
});
