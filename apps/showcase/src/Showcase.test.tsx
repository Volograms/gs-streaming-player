import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chooseShowcaseBackend } from "./backendSelection.js";
import { LandingPage } from "./LandingPage.js";
import { PlayerPage } from "./PlayerPage.js";

describe("showcase", () => {
  it("renders the preview status and tiered support on the landing page", () => {
    const markup = renderToStaticMarkup(<LandingPage />);

    expect(markup).toContain("Public preview");
    expect(markup).toContain("PlayCanvas + SOG v2");
    expect(markup).toContain("No dataset is bundled");
  });

  it("renders an accessible manifest picker when no sample is configured", () => {
    const markup = renderToStaticMarkup(<PlayerPage />);

    expect(markup).toContain("Open a 4DGS manifest");
    expect(markup).toContain('label for="manifest-url"');
    expect(markup).toContain('aria-label="4D Gaussian Splat scene"');
  });

  it("keeps desktop WebGPU but selects the Quest WebGL2 fallback when needed", () => {
    expect(chooseShowcaseBackend(true, false, "session-unsupported")).toBe("webgpu");
    expect(chooseShowcaseBackend(true, false, "webgpu-binding-unavailable")).toBe(
      "webgl2",
    );
    expect(chooseShowcaseBackend(false, false, "available")).toBe("webgl2");
  });
});
