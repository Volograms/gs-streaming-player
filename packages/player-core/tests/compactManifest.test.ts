import { describe, expect, it } from "vitest";

import {
  assertValidManifest,
  compactManifest,
  loadManifest,
  validateManifest,
} from "../src/index.js";

import type { GaussianSequenceManifest } from "../src/index.js";

function fixture(): GaussianSequenceManifest {
  const frameRate = 29.97;
  return {
    version: "1.0",
    id: "compact-test",
    frameRate,
    frameCount: 3,
    durationSeconds: 3 / frameRate,
    staticObjects: [{ id: "room", url: "static/room.sog" }],
    audio: { url: "audio/track.ogg", offsetSeconds: 0.1 },
    dynamicSequences: [
      {
        id: "actor",
        frameRate,
        frameCount: 3,
        frames: Array.from({ length: 3 }, (_, frameIndex) => ({
          codec: "sog-v2",
          frameIndex,
          timestampSeconds: frameIndex / frameRate,
          url: `dynamic/${frameIndex}-preview.sog`,
          metadata: { sourceFile: `frame${frameIndex}.ply` },
          qualityLevels: [0, 1].map((level) => ({
            level,
            codec: "sog-v2",
            url: `dynamic/${frameIndex}-${level === 0 ? "preview" : "full"}.sog`,
            detailLevel: level === 0 ? 0.1 + frameIndex * 0.000001 : 1,
            byteSize: 1000 * (level + 1) + frameIndex,
            splatCount: 100 * (level + 1) + frameIndex,
            minimumPlayable: level === 0,
            metadata: {
              tier: level === 0 ? "preview" : "full",
              strategy: "decimation",
              custom: { source: frameIndex },
            },
          })),
        })),
      },
    ],
  };
}

describe("manifest 1.1", () => {
  it("round-trips regular timing, quality metadata and exact per-frame measurements without mutating the input", () => {
    const source = fixture();
    const untouched = structuredClone(source);
    const compact = compactManifest(source);
    const sequence = compact.dynamicSequences[0]!;
    expect(sequence).toMatchObject({ codec: "sog-v2", regularTiming: true });
    expect(sequence.qualityDefaults).toEqual([
      {
        level: 0,
        minimumPlayable: true,
        metadata: { tier: "preview", strategy: "decimation" },
      },
      {
        level: 1,
        detailLevel: 1,
        minimumPlayable: false,
        metadata: { tier: "full", strategy: "decimation" },
      },
    ]);
    expect(sequence.frames[0]).not.toHaveProperty("frameIndex");
    expect(sequence.frames[0]).not.toHaveProperty("timestampSeconds");
    expect(sequence.frames[0]).not.toHaveProperty("codec");
    expect(sequence.frames[0]).not.toHaveProperty("url");
    expect(assertValidManifest(compact)).toEqual({ ...source, version: "1.1" });
    expect(source).toEqual(untouched);
    expect(compactManifest(compact)).toEqual(compact);
  });

  it("preserves irregular and rounded timing and rejects forced regular conversion", () => {
    const source = fixture();
    source.dynamicSequences[0]!.frames[1]!.timestampSeconds = 0.04;
    const compact = compactManifest(source);
    expect(compact.dynamicSequences[0]!.regularTiming).toBe(false);
    expect(assertValidManifest(compact)).toEqual({ ...source, version: "1.1" });
    expect(() => compactManifest(source, { regularTiming: true })).toThrow(
      "exact regular timing",
    );
    source.dynamicSequences[0]!.frames[1]!.timestampSeconds = 0.033367;
    expect(compactManifest(source).dynamicSequences[0]!.regularTiming).toBe(false);
  });

  it("allows explicit timing on regular sequences and detects timing separately per sequence", () => {
    const source = fixture();
    expect(
      compactManifest(source, { regularTiming: false }).dynamicSequences[0]!.frames[1]!
        .timestampSeconds,
    ).toBe(1 / 29.97);
    const second = structuredClone(source.dynamicSequences[0]!);
    second.id = "irregular";
    second.frames[1]!.timestampSeconds = 0.04;
    source.dynamicSequences.push(second);
    expect(
      compactManifest(source).dynamicSequences.map(
        (sequence) => sequence.regularTiming,
      ),
    ).toEqual([true, false]);
  });

  it("keeps distinct fallback URLs and heterogeneous codecs", () => {
    const source = fixture();
    const frame = source.dynamicSequences[0]!.frames[1]!;
    frame.url = "alternate.rad";
    frame.codec = "spz-v4";
    const compact = compactManifest(source);
    expect(compact.dynamicSequences[0]).not.toHaveProperty("codec");
    expect(compact.dynamicSequences[0]!.frames[1]!.url).toBe("alternate.rad");
    expect(assertValidManifest(compact)).toEqual({ ...source, version: "1.1" });
  });

  it("applies level-keyed defaults, explicit overrides and shallow metadata overrides", () => {
    const compact = compactManifest(fixture());
    const frame = compact.dynamicSequences[0]!.frames[0]!;
    frame.qualityLevels![0]!.metadata = { tier: "custom", custom: { source: 99 } };
    frame.qualityLevels![0]!.minimumPlayable = false;
    frame.qualityLevels![1]!.minimumPlayable = true;
    const expanded = assertValidManifest(compact).dynamicSequences[0]!.frames[0]!;
    expect(expanded.url).toBe("dynamic/0-full.sog");
    expect(expanded.qualityLevels![0]!.metadata).toEqual({
      tier: "custom",
      strategy: "decimation",
      custom: { source: 99 },
    });
  });

  it("resolves inherited fallback URLs through the normal manifest loader", async () => {
    const manifest = await loadManifest(
      new Blob([JSON.stringify(compactManifest(fixture()))]),
      { baseUrl: "https://media.example.test/data/manifest.json" },
    );
    expect(manifest.dynamicSequences[0]!.frames[1]).toMatchObject({
      frameIndex: 1,
      timestampSeconds: 1 / 29.97,
      url: "https://media.example.test/data/dynamic/1-preview.sog",
      codec: "sog-v2",
    });
    expect(manifest.dynamicSequences[0]!.frames[1]!.qualityLevels![1]!.url).toBe(
      "https://media.example.test/data/dynamic/1-full.sog",
    );
  });

  it("rejects missing or conflicting timing, unresolved URLs and invalid defaults", () => {
    const mutations = [
      (value: ReturnType<typeof compactManifest>) => {
        value.dynamicSequences[0]!.frames[0]!.timestampSeconds = 0;
      },
      (value: ReturnType<typeof compactManifest>) => {
        value.dynamicSequences[0]!.regularTiming = false;
      },
      (value: ReturnType<typeof compactManifest>) => {
        delete value.dynamicSequences[0]!.frames[0]!.qualityLevels;
      },
      (value: ReturnType<typeof compactManifest>) => {
        value.dynamicSequences[0]!.qualityDefaults!.push({ level: 0 });
      },
      (value: ReturnType<typeof compactManifest>) => {
        value.dynamicSequences[0]!.frames[0]!.qualityLevels![1]!.minimumPlayable = true;
      },
      (value: ReturnType<typeof compactManifest>) => {
        value.dynamicSequences[0]!.frames[1]!.frameIndex = 9;
      },
      (value: ReturnType<typeof compactManifest>) => {
        value.durationSeconds = 0.01;
      },
    ];
    for (const mutate of mutations) {
      const value = compactManifest(fixture());
      mutate(value);
      expect(validateManifest(value).valid).toBe(false);
    }
  });
});
