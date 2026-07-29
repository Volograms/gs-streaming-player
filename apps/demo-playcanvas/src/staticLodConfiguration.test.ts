import { describe, expect, it } from "vitest";

import { parseStaticLodConfiguration } from "./staticLodConfiguration.js";

describe("parseStaticLodConfiguration", () => {
  it("leaves distance LOD and the global budget at PlayCanvas defaults", () => {
    expect(parseStaticLodConfiguration({})).toEqual({});
    expect(parseStaticLodConfiguration({ lodLevel: "  ", splatBudget: "" })).toEqual(
      {},
    );
  });

  it("accepts a pinned LOD level and splat budget", () => {
    expect(
      parseStaticLodConfiguration({ lodLevel: "2", splatBudget: "500000" }),
    ).toEqual({ lodLevel: 2, splatBudget: 500_000 });
  });

  it("accepts zero as finest LOD and unlimited budget", () => {
    expect(parseStaticLodConfiguration({ lodLevel: "0", splatBudget: "0" })).toEqual({
      lodLevel: 0,
      splatBudget: 0,
    });
  });

  it("rejects negative and fractional values", () => {
    expect(() => parseStaticLodConfiguration({ lodLevel: "-1" })).toThrow(
      "VITE_STATIC_GS_LOD_LEVEL",
    );
    expect(() => parseStaticLodConfiguration({ splatBudget: "1.5" })).toThrow(
      "VITE_PLAYCANVAS_SPLAT_BUDGET",
    );
  });
});
