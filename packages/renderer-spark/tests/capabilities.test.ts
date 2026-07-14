import { describe, expect, it } from "vitest";

import { sparkRendererCapabilities } from "../src/index.js";

describe("sparkRendererCapabilities", () => {
  it("documents the implemented adapter capabilities", () => {
    expect(sparkRendererCapabilities).toMatchObject({
      dynamicFramePreparation: true,
      pagedRadStreaming: true,
      progressiveLevelOfDetail: true,
      rendererAdapterImplemented: true,
    });
  });
});
