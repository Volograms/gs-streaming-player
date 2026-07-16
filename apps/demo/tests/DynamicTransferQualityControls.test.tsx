import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DynamicTransferQualityControls } from "../src/DynamicTransferQualityControls.js";

const levels = [
  {
    detailLevel: 0.25,
    level: 1,
    metadata: { tier: "minimum" },
    minimumPlayable: true,
    splatCount: 68_535,
    url: "/frame-minimum.spz",
  },
  {
    detailLevel: 0.5,
    level: 2,
    metadata: { tier: "medium" },
    splatCount: 137_070,
    url: "/frame-medium.spz",
  },
  {
    detailLevel: 1,
    level: 3,
    metadata: { tier: "full" },
    splatCount: 274_140,
    url: "/frame-full.spz",
  },
] as const;

describe("DynamicTransferQualityControls", () => {
  it("shows selected and currently presented fixed tiers separately", () => {
    const markup = renderToStaticMarkup(
      <DynamicTransferQualityControls
        adaptive={false}
        disabled={false}
        levels={levels}
        onChange={() => undefined}
        presentedLevel={1}
        selectedDetailLevel={0.5}
      />,
    );

    expect(markup).toContain("SPZ quality tier");
    expect(markup).toContain("Medium · 50% · 137,070 splats");
    expect(markup).toContain("Selected Medium");
    expect(markup).toContain("presented Minimum");
    expect(markup).toContain('data-selected-detail="0.5"');
    expect(markup).toContain('data-presented-level="1"');
  });

  it("disables manual selection while automatic quality is active", () => {
    const markup = renderToStaticMarkup(
      <DynamicTransferQualityControls
        adaptive
        disabled={false}
        levels={levels}
        onChange={() => undefined}
        selectedDetailLevel={0.25}
      />,
    );

    expect(markup).toContain("<select disabled");
    expect(markup).toContain("Automatic · presented pending");
  });
});
