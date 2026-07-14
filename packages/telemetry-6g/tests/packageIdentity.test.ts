import { describe, expect, it } from "vitest";

import { SIX_G_TELEMETRY_PACKAGE_ID } from "../src/index.js";

describe("telemetry package identity", () => {
  it("uses the agreed package scope", () => {
    expect(SIX_G_TELEMETRY_PACKAGE_ID).toBe("@6g-path/gaussian-telemetry-6g");
  });
});
