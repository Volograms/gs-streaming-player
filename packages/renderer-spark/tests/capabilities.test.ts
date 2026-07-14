import { describe, expect, it } from "vitest";

import { sparkRendererCapabilities } from "../src/index.js";

describe("sparkRendererCapabilities", () => {
  it("documents the capabilities expected from the upcoming adapter", () => {
    expect(sparkRendererCapabilities).toMatchObject({
      pagedRadStreaming: true,
      progressiveLevelOfDetail: true,
      rendererAdapterImplemented: false,
    });
  });
});
