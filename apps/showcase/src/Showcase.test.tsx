import { ManifestLoadValidationError } from "@6g-path/gaussian-player";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chooseShowcaseBackend } from "./backendSelection.js";
import { describeShowcaseError } from "./describeError.js";
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
    const markup = renderToStaticMarkup(<PlayerPage requestedManifestUrl="" />);

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

  it("shows actionable manifest validation paths", () => {
    expect(
      describeShowcaseError(
        new ManifestLoadValidationError([
          {
            code: "schema",
            message: "must NOT have additional properties",
            path: "/staticObjects/0/transform/rotationDegrees",
          },
          {
            code: "schema",
            message: "must be object",
            path: "/staticObjects/0/transform/scale",
          },
        ]),
      ),
    ).toBe(
      "Manifest validation failed: /staticObjects/0/transform/rotationDegrees: must NOT have additional properties; /staticObjects/0/transform/scale: must be object",
    );
  });
});
