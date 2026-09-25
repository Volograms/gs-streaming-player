import { describe, expect, it } from "vitest";

import { sequenceQualityLevels } from "../src/quality/sequenceQualityLevels.js";

import type { DynamicGaussianSequence } from "../src/index.js";

function sequence(): DynamicGaussianSequence {
  return {
    id: "actor",
    frameRate: 30,
    frameCount: 2,
    frames: [0, 1].map((frameIndex) => ({
      frameIndex,
      timestampSeconds: frameIndex / 30,
      url: `full-${frameIndex}.sog`,
      byteSize: 10_000,
      qualityLevels: [0.1, 0.2499 + frameIndex * 0.0001, 0.5, 1].map(
        (detailLevel, level) => ({
          level,
          detailLevel,
          minimumPlayable: level === 1,
          byteSize: (level + 1) * 100 + frameIndex * 20,
          url: `${frameIndex}-${level}.sog`,
        }),
      ),
    })),
  };
}

describe("sequenceQualityLevels", () => {
  it("uses the authored floor, varying measured ratios and actual mean bytes", () => {
    expect(sequenceQualityLevels(sequence())).toEqual([
      { detailLevel: 0.2499, estimatedFrameBytes: 210 },
      { detailLevel: 0.5, estimatedFrameBytes: 310 },
      { detailLevel: 1, estimatedFrameBytes: 410 },
    ]);
  });

  it("does not mistake the base URL's byte size for an unmeasured tier", () => {
    const source = sequence();
    delete source.frames[0]!.qualityLevels![2]!.byteSize;
    expect(sequenceQualityLevels(source)[1]).toEqual({ detailLevel: 0.5 });
  });

  it("collapses equal tier minima and retains the largest mean byte estimate", () => {
    const source = sequence();
    source.frames[0]!.qualityLevels![1]!.detailLevel = 0.5;
    source.frames[1]!.qualityLevels![1]!.detailLevel = 0.51;
    source.frames[0]!.qualityLevels![2]!.detailLevel = 0.52;
    expect(sequenceQualityLevels(source)).toEqual([
      { detailLevel: 0.5, estimatedFrameBytes: 310 },
      { detailLevel: 1, estimatedFrameBytes: 410 },
    ]);
  });

  it("merges equal details across the playable floor before excluding previews", () => {
    const source = sequence();
    for (const frame of source.frames) {
      frame.qualityLevels![0]!.detailLevel = 0.25;
      frame.qualityLevels![0]!.byteSize = 500;
      frame.qualityLevels![1]!.detailLevel = 0.25;
    }
    expect(sequenceQualityLevels(source)).toEqual([
      { detailLevel: 0.25, estimatedFrameBytes: 500 },
      { detailLevel: 0.5, estimatedFrameBytes: 310 },
      { detailLevel: 1, estimatedFrameBytes: 410 },
    ]);
  });

  it.each([1, 2])("keeps bytes unknown if duplicate tier %i is unmeasured", (level) => {
    const source = sequence();
    for (const frame of source.frames) frame.qualityLevels![1]!.detailLevel = 0.5;
    delete source.frames[0]!.qualityLevels![level]!.byteSize;
    expect(sequenceQualityLevels(source)).toEqual([
      { detailLevel: 0.5 },
      { detailLevel: 1, estimatedFrameBytes: 410 },
    ]);
  });

  it("supports legacy ratio metadata and excludes incomplete tiers", () => {
    const source = sequence();
    for (const frame of source.frames)
      for (const level of frame.qualityLevels!) {
        level.metadata = { targetLeafRatio: level.detailLevel };
        delete level.detailLevel;
      }
    source.frames[1]!.qualityLevels!.pop();
    expect(sequenceQualityLevels(source).map((level) => level.detailLevel)).toEqual([
      0.2499, 0.5,
    ]);
  });
});
