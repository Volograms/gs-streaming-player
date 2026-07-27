import { describe, expect, it } from "vitest";

import { parseGsplatRenderConfiguration } from "./gsplatRenderConfiguration.js";

describe("parseGsplatRenderConfiguration", () => {
  it("leaves PlayCanvas projection rejection at its defaults", () => {
    expect(parseGsplatRenderConfiguration({})).toEqual({});
  });

  it("accepts screen-space and foveated rejection controls", () => {
    expect(
      parseGsplatRenderConfiguration({
        foveationCenter: "0.25",
        foveationStrength: "8",
        minContribution: "5",
        minPixelSize: "4",
      }),
    ).toEqual({
      foveationCenter: 0.25,
      foveationStrength: 8,
      minContribution: 5,
      minPixelSize: 4,
    });
  });

  it("rejects invalid thresholds and foveation centers", () => {
    expect(() => parseGsplatRenderConfiguration({ minPixelSize: "-1" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_MIN_PIXEL_SIZE",
    );
    expect(() => parseGsplatRenderConfiguration({ foveationCenter: "1.1" })).toThrow(
      "VITE_PLAYCANVAS_GSPLAT_FOVEATION_CENTER",
    );
  });
});
