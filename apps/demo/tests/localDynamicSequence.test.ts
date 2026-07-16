import { describe, expect, it } from "vitest";

import {
  createLocalDynamicSequence,
  loadLocalDynamicSequence,
} from "../src/localDynamicSequence.js";

describe("createLocalDynamicSequence", () => {
  it("creates contiguous logical frames from the configured source range", () => {
    const sequence = createLocalDynamicSequence({
      VITE_DYNAMIC_RAD_BASE_URL: "/assets/actor/",
      VITE_DYNAMIC_RAD_END_FRAME: "42",
      VITE_DYNAMIC_RAD_START_FRAME: "40",
    });

    expect(sequence).toMatchObject({
      frameCount: 3,
      frameRate: 30,
      frames: [
        {
          frameIndex: 0,
          metadata: { sourceFrameIndex: 40 },
          timestampSeconds: 0,
          url: "/assets/actor/frame0040-lod.rad",
        },
        {
          frameIndex: 1,
          metadata: { sourceFrameIndex: 41 },
          timestampSeconds: 1 / 30,
          url: "/assets/actor/frame0041-lod.rad",
        },
        {
          frameIndex: 2,
          metadata: { sourceFrameIndex: 42 },
          timestampSeconds: 2 / 30,
          url: "/assets/actor/frame0042-lod.rad",
        },
      ],
      transform: { rotation: { w: 0, x: 1, y: 0, z: 0 } },
    });
  });

  it("returns no sequence without a base URL", () => {
    expect(createLocalDynamicSequence({})).toBeUndefined();
  });

  it("rejects an inverted source range", () => {
    expect(() =>
      createLocalDynamicSequence({
        VITE_DYNAMIC_RAD_BASE_URL: "/assets/actor",
        VITE_DYNAMIC_RAD_END_FRAME: "40",
        VITE_DYNAMIC_RAD_START_FRAME: "41",
      }),
    ).toThrow(/END_FRAME/);
  });

  it("loads generated flat quality tiers and resolves their URLs", async () => {
    const sequence = await loadLocalDynamicSequence(
      {
        VITE_DYNAMIC_QUALITY_INDEX_URL: "/assets/actor-cuts/quality-cuts.json",
        VITE_DYNAMIC_RAD_END_FRAME: "41",
        VITE_DYNAMIC_RAD_START_FRAME: "40",
      },
      {
        baseUrl: "https://demo.example.test/",
        fetch: async () =>
          new Response(
            JSON.stringify({
              format: "flat-spz-quality-cuts",
              frames: [40, 41].map((sourceFrameIndex) => ({
                qualityLevels: [
                  {
                    byteSize: 250,
                    level: 1,
                    metadata: { targetLeafRatio: 0.25 },
                    minimumPlayable: true,
                    splatCount: 2_500,
                    url: `frame${sourceFrameIndex}-minimum.spz`,
                  },
                ],
                sourceFile: `frame${sourceFrameIndex}-lod.rad`,
              })),
              version: 1,
            }),
          ),
      },
    );

    expect(sequence?.frames[0]).toMatchObject({
      frameIndex: 0,
      qualityLevels: [
        {
          byteSize: 250,
          detailLevel: 0.25,
          level: 1,
          minimumPlayable: true,
          splatCount: 2_500,
          url: "https://demo.example.test/assets/actor-cuts/frame40-minimum.spz",
        },
      ],
      url: "https://demo.example.test/assets/actor-cuts/frame40-minimum.spz",
    });
    expect(sequence?.frames[1]?.metadata).toEqual({ sourceFrameIndex: 41 });
  });
});
