import { describe, expect, it } from "vitest";

import { StreamingDiagnostics } from "./streamingDiagnostics.js";

describe("StreamingDiagnostics", () => {
  it("separates fetch stages and reports playback and preparation pressure", () => {
    let now = 0;
    const diagnostics = new StreamingDiagnostics(6, 2, () => now);

    diagnostics.observeTrace({
      atMs: 100,
      bodyReadMs: 80,
      durationMs: 100,
      frameIndex: 0,
      loadedBytes: 1_000,
      responseLatencyMs: 20,
      type: "compressed-fetch-ready",
    });
    diagnostics.observeTrace({
      atMs: 110,
      durationMs: 7,
      frameIndex: 0,
      type: "base-started",
    });
    diagnostics.observeTrace({
      atMs: 140,
      frameIndex: 0,
      phase: "gpu-upload",
      stageDurationMs: 30,
      type: "renderer-phase",
    });
    diagnostics.observeTrace({
      atMs: 145,
      durationMs: 145,
      frameIndex: 0,
      type: "base-ready",
    });
    diagnostics.observeTrace({ atMs: 150, frameIndex: 0, type: "presented" });
    diagnostics.observeTrace({ atMs: 200, frameIndex: 1, type: "presented" });

    diagnostics.observePlayback({ droppedFrameCount: 0, lifecycle: "BUFFERING" });
    now = 50;
    diagnostics.observePlayback({ droppedFrameCount: 2, lifecycle: "PLAYING" });

    expect(diagnostics.snapshot()).toMatchObject({
      aggregateFetchMbps: 0.08,
      basePreparation: { count: 1, p50: 145, p95: 145 },
      bodyRead: { count: 1, p50: 80, p95: 80 },
      completedFetchCount: 1,
      configuredFetchConcurrency: 6,
      configuredPreparationConcurrency: 2,
      droppedFrameCount: 2,
      preparationQueue: { count: 1, p50: 7, p95: 7 },
      presentationFramesPerSecond: 20,
      requestMbps: { count: 1, p50: 0.1, p95: 0.1 },
      responseLatency: { count: 1, p50: 20, p95: 20 },
      sogAssetLoad: { count: 1, p50: 30, p95: 30 },
      stallCount: 1,
      stallTimeMs: 50,
      totalFetch: { count: 1, p50: 100, p95: 100 },
    });

    diagnostics.reset();
    expect(diagnostics.snapshot()).toMatchObject({
      completedFetchCount: 0,
      stallCount: 0,
      totalFetch: { count: 0 },
    });
  });
});
