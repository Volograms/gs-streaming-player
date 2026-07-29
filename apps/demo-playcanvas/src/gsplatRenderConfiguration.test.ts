import { describe, expect, it } from "vitest";

import { parseGsplatRenderConfiguration } from "./gsplatRenderConfiguration.js";

describe("parseGsplatRenderConfiguration", () => {
  it("leaves PlayCanvas projection rejection at its defaults", () => {
    expect(parseGsplatRenderConfiguration({})).toEqual({});
  });

  it("accepts screen-space and foveated rejection controls", () => {
    expect(
      parseGsplatRenderConfiguration({
        alphaClipForward: "0.015686",
        foveationCenter: "0.25",
        foveationStrength: "8",
        gaussianSort: "cpu",
        minContribution: "5",
        minPixelSize: "4",
        xrFixedFoveation: "0.75",
      }),
    ).toEqual({
      alphaClipForward: 0.015686,
      foveationCenter: 0.25,
      foveationStrength: 8,
      gaussianSort: "cpu",
      minContribution: 5,
      minPixelSize: 4,
      xrFixedFoveation: 0.75,
    });
  });

  it("rejects invalid thresholds and foveation centers", () => {
    expect(() => parseGsplatRenderConfiguration({ minPixelSize: "-1" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_MIN_PIXEL_SIZE",
    );
    expect(() => parseGsplatRenderConfiguration({ foveationCenter: "1.1" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_FOVEATION_CENTER",
    );
    expect(() => parseGsplatRenderConfiguration({ alphaClipForward: "1.1" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_ALPHA_CLIP_FORWARD",
    );
    expect(() => parseGsplatRenderConfiguration({ xrFixedFoveation: "-0.1" })).toThrow(
      "VITE_PLAYCANVAS_XR_FIXED_FOVEATION",
    );
    expect(() => parseGsplatRenderConfiguration({ gaussianSort: "fast" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_SORT",
    );
  });
});
