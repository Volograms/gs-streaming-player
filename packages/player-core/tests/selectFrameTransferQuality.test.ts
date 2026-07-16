import { describe, expect, it } from "vitest";

import { selectFrameTransferQuality } from "../src/index.js";

import type { GaussianFrameSource } from "../src/index.js";

const source: GaussianFrameSource = {
  frameIndex: 0,
  qualityLevels: [
    {
      byteSize: 100,
      level: 0,
      metadata: { targetLeafRatio: 0.1 },
      splatCount: 10,
      url: "/frame-preview.spz",
    },
    {
      byteSize: 250,
      level: 1,
      metadata: { targetLeafRatio: 0.25 },
      minimumPlayable: true,
      splatCount: 25,
      url: "/frame-minimum.spz",
    },
    {
      byteSize: 500,
      detailLevel: 0.5,
      level: 2,
      splatCount: 50,
      url: "/frame-medium.spz",
    },
  ],
  timestampSeconds: 0,
  url: "/frame.rad",
};

describe("selectFrameTransferQuality", () => {
  it("uses the minimum-playable tier as the presentation floor", () => {
    expect(selectFrameTransferQuality(source, 0.1)).toEqual({
      quality: {
        detailLevel: 0.25,
        level: 1,
        mode: "fixed",
        splatCount: 25,
      },
      source: {
        ...source,
        byteSize: 250,
        url: "/frame-minimum.spz",
      },
    });
  });

  it("selects the smallest tier that meets a higher target", () => {
    expect(selectFrameTransferQuality(source, 0.4)?.source.url).toBe(
      "/frame-medium.spz",
    );
  });

  it("returns no selection when a frame has no addressable tiers", () => {
    expect(
      selectFrameTransferQuality(
        { frameIndex: 0, timestampSeconds: 0, url: "/frame.rad" },
        0.25,
      ),
    ).toBeUndefined();
  });
});
