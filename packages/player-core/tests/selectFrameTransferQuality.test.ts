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

  it("selects an unsorted ladder with the same duplicate-detail tie breaks", () => {
    const frame = {
      ...source,
      qualityLevels: [
        { level: 3, detailLevel: 0.5, url: "/same-detail-later.sog" },
        { level: 0, detailLevel: 0.1, url: "/preview.sog" },
        { level: 2, detailLevel: 0.5, url: "/same-detail-first.sog" },
      ],
    };
    expect(selectFrameTransferQuality(frame, 0.4)?.source.url).toBe(
      "/same-detail-first.sog",
    );
    expect(selectFrameTransferQuality(frame, 1)?.source.url).toBe(
      "/same-detail-later.sog",
    );
  });

  it("uses the lowest valid marked floor and skips invalid or unaddressable tiers", () => {
    const frame = {
      ...source,
      qualityLevels: [
        { level: 4, detailLevel: 0.9, url: "/high.sog", minimumPlayable: true },
        { level: 3, detailLevel: NaN, url: "/invalid.sog", minimumPlayable: true },
        { level: 0, detailLevel: 0.1, minimumPlayable: true },
        { level: 2, detailLevel: 0.5, url: "/medium.sog", minimumPlayable: true },
        { level: 1, detailLevel: 0.25, url: "/low.sog" },
      ],
    };
    expect(selectFrameTransferQuality(frame, 0.1)?.source.url).toBe("/medium.sog");
    expect(selectFrameTransferQuality(frame, 0.6)?.source.url).toBe("/high.sog");
  });

  it("skips holes in a caller-provided tier ladder", () => {
    const qualityLevels: NonNullable<GaussianFrameSource["qualityLevels"]> = [];
    qualityLevels[1] = source.qualityLevels![1]!;
    expect(
      selectFrameTransferQuality({ ...source, qualityLevels }, 0.1)?.source.url,
    ).toBe("/frame-minimum.spz");
  });
});
