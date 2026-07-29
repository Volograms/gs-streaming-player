import { describe, expect, it } from "vitest";

import { collectShowcaseQualityOptions } from "./qualityOptions.js";

import type { DynamicGaussianSequence } from "@6g-path/gaussian-player";

describe("collectShowcaseQualityOptions", () => {
  it("deduplicates and orders the generated dynamic transfer tiers", () => {
    const sequence = {
      frameCount: 2,
      frameRate: 30,
      frames: [0, 1].map((frameIndex) => ({
        frameIndex,
        qualityLevels: [
          {
            detailLevel: 1,
            level: 3,
            metadata: { targetRatio: 1, tier: "full" },
            url: `frame-${frameIndex}-full.sog`,
          },
          {
            detailLevel: frameIndex === 0 ? 0.5003 : 0.4996,
            level: 2,
            metadata: { targetRatio: 0.5, tier: "medium" },
            url: `frame-${frameIndex}-medium.sog`,
          },
          {
            detailLevel: frameIndex === 0 ? 0.2501 : 0.2498,
            level: 1,
            metadata: { targetRatio: 0.25, tier: "minimum" },
            url: `frame-${frameIndex}-minimum.sog`,
          },
          {
            detailLevel: frameIndex === 0 ? 0.1002 : 0.0999,
            level: 0,
            metadata: { targetRatio: 0.1, tier: "preview" },
            url: `frame-${frameIndex}-preview.sog`,
          },
        ],
        timestampSeconds: frameIndex / 30,
        url: `frame-${frameIndex}-minimum.sog`,
      })),
      id: "actor",
    } satisfies DynamicGaussianSequence;

    expect(collectShowcaseQualityOptions(sequence)).toEqual([
      { detailLevel: 0.0999, label: "Preview · 10%" },
      { detailLevel: 0.2498, label: "Minimum · 25%" },
      { detailLevel: 0.4996, label: "Medium · 50%" },
      { detailLevel: 1, label: "Full · 100%" },
    ]);
  });
});
