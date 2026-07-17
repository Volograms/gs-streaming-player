import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PackedFrameMemoryBenchmarkControls } from "../src/PackedFrameMemoryBenchmarkControls.js";

describe("PackedFrameMemoryBenchmarkControls", () => {
  it("runs and renders a machine-readable packed-memory result", () => {
    const result = {
      bind: { medianMs: 0.1, p95Ms: 0.2 },
      clone: { medianMs: 1.2, p95Ms: 1.7 },
      iterations: 8,
      payloadBytes: 15_600_000,
      snapshotDurationMs: 2.5,
      sphericalHarmonicsDegree: 3 as const,
      splatCount: 279_000,
    };

    const markup = renderToStaticMarkup(
      <PackedFrameMemoryBenchmarkControls
        disabled={false}
        onRun={() => undefined}
        result={result}
      />,
    );

    expect(markup).toContain("Test current frame");
    expect(markup).toContain("279,000 splats");
    expect(markup).toContain("15.6 MB raw");
    expect(markup).toContain("8 passes");
    expect(markup).toContain("Zero-copy bind p50/p95");
    expect(markup).toContain("data-packed-memory-benchmark=");
  });
});
