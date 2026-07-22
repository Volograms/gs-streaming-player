import { describe, expect, it, vi } from "vitest";

import {
  CAPTURE_TO_WORLD_TRANSFORM,
  createLocalDynamicSequence,
  loadLocalDynamicSequence,
} from "../src/index.js";

describe("local dynamic sequence support", () => {
  it("creates the configured frame range in the shared world coordinates", () => {
    const sequence = createLocalDynamicSequence({
      VITE_DYNAMIC_FRAME_CODEC: "spz-v4",
      VITE_DYNAMIC_RAD_BASE_URL: "/frames",
      VITE_DYNAMIC_RAD_END_FRAME: "42",
      VITE_DYNAMIC_RAD_START_FRAME: "40",
    });

    expect(sequence?.frameCount).toBe(3);
    expect(sequence?.frames.map(({ url }) => url)).toEqual([
      "/frames/frame0040-lod.rad",
      "/frames/frame0041-lod.rad",
      "/frames/frame0042-lod.rad",
    ]);
    expect(sequence?.transform).toBe(CAPTURE_TO_WORLD_TRANSFORM);
  });

  it("requires a quality index for SOG v2 sequences", () => {
    expect(() =>
      createLocalDynamicSequence({
        VITE_DYNAMIC_FRAME_CODEC: "sog-v2",
        VITE_DYNAMIC_RAD_BASE_URL: "/frames",
      }),
    ).toThrow(/requires VITE_DYNAMIC_QUALITY_INDEX_URL/);
  });

  it("binds the default browser fetch receiver", async () => {
    const fetchImplementation = vi.fn(async function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return new Response(
        JSON.stringify({
          format: "flat-spz-quality-cuts",
          frames: [
            {
              qualityLevels: [
                {
                  detailLevel: 0.25,
                  minimumPlayable: true,
                  url: "frame0040-min.spz",
                },
              ],
              sourceFile: "frame0040-lod.rad",
            },
          ],
          version: 1,
        }),
        { status: 200 },
      );
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImplementation as typeof globalThis.fetch;
    try {
      const sequence = await loadLocalDynamicSequence(
        {
          VITE_DYNAMIC_FRAME_CODEC: "spz-v4",
          VITE_DYNAMIC_QUALITY_INDEX_URL: "/quality-cuts.json",
          VITE_DYNAMIC_RAD_END_FRAME: "40",
          VITE_DYNAMIC_RAD_START_FRAME: "40",
        },
        { baseUrl: "https://example.test/demo/" },
      );
      expect(sequence?.frames[0]?.url).toBe("https://example.test/frame0040-min.spz");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("loads SOG v2 tiers from a flat SOG quality-cuts index", async () => {
    const sequence = await loadLocalDynamicSequence(
      {
        VITE_DYNAMIC_FRAME_CODEC: "sog-v2",
        VITE_DYNAMIC_QUALITY_INDEX_URL: "/sog/quality-cuts.json",
        VITE_DYNAMIC_RAD_END_FRAME: "40",
        VITE_DYNAMIC_RAD_START_FRAME: "40",
      },
      {
        baseUrl: "https://example.test/demo/",
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                format: "flat-sog-quality-cuts",
                frames: [
                  {
                    qualityLevels: [
                      {
                        detailLevel: 0.5,
                        minimumPlayable: true,
                        url: "frame0040-medium.sog",
                      },
                    ],
                    sourceFile: "frame0040-lod.rad",
                  },
                ],
                version: 1,
              }),
              { status: 200 },
            ),
        ),
      },
    );

    expect(sequence?.frames[0]).toMatchObject({
      codec: "sog-v2",
      url: "https://example.test/sog/frame0040-medium.sog",
    });
    expect(sequence?.frames[0]?.qualityLevels?.[0]).toMatchObject({
      codec: "sog-v2",
      detailLevel: 0.5,
      url: "https://example.test/sog/frame0040-medium.sog",
    });
  });
});
