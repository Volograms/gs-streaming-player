import { describe, expect, it } from "vitest";

import { resolvePlayCanvasDemoSceneMode } from "./sceneConfiguration.js";

describe("resolvePlayCanvasDemoSceneMode", () => {
  it("enables dynamic playback when a quality index is configured", () => {
    expect(
      resolvePlayCanvasDemoSceneMode({
        dynamicQualityIndexUrl: "/assets/dynamic/quality-cuts.json",
        staticGsUrl: "/assets/static/lod-meta.json",
      }),
    ).toBe("dynamic-enabled");
  });

  it("allows a static-only scene without a dynamic quality index", () => {
    expect(
      resolvePlayCanvasDemoSceneMode({
        dynamicQualityIndexUrl: "  ",
        staticGsUrl: "/assets/static/lod-meta.json",
      }),
    ).toBe("static-only");
  });

  it("reports an entirely unconfigured scene", () => {
    expect(
      resolvePlayCanvasDemoSceneMode({
        dynamicQualityIndexUrl: undefined,
        staticGsUrl: undefined,
      }),
    ).toBe("unconfigured");
  });
});
