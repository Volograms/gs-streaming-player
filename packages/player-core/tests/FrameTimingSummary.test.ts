import { describe, expect, it } from "vitest";

import { summariseFrameTimings } from "../src/index.js";

import type { FrameRingBufferTraceEvent } from "../src/index.js";

describe("summariseFrameTimings", () => {
  it("reports queue, renderer, refinement, handoff, throughput, and switching timing", () => {
    const events: FrameRingBufferTraceEvent[] = [
      { atMs: 0, durationMs: 5, frameIndex: 0, type: "base-started" },
      {
        atMs: 20,
        durationMs: 20,
        frameIndex: 0,
        phase: "minimum-renderable",
        type: "renderer-phase",
      },
      {
        atMs: 25,
        durationMs: 25,
        frameIndex: 0,
        quality: {
          detailLevel: 0,
          loadedBytes: 1_000,
          state: "root-ready",
        },
        type: "base-ready",
      },
      { atMs: 35, durationMs: 10, frameIndex: 0, type: "refinement-ready" },
      { atMs: 40, durationMs: 40, frameIndex: 0, type: "presentation-ready" },
      { atMs: 41, durationMs: 41, frameIndex: 0, type: "presented" },
      { atMs: 73, durationMs: 10, frameIndex: 1, type: "presentation-ready" },
      { atMs: 74, durationMs: 11, frameIndex: 1, type: "presented" },
      {
        atMs: 80,
        renderCallSamplesMs: [3, 4],
        renderIntervalSamplesMs: [16, 17],
        sortSamplesMs: [8],
        sparkUpdateSamplesMs: [10],
        type: "render-timing",
      },
    ];

    expect(summariseFrameTimings(events)).toMatchObject({
      basePreparation: { count: 1, medianMs: 25, p95Ms: 25 },
      estimatedBaseThroughputBps: 320_000,
      handoff: { count: 2, maximumMs: 1 },
      minimumRenderable: { count: 1, medianMs: 20 },
      presentationCadence: { count: 1, medianMs: 33 },
      presentationWait: { count: 2, maximumMs: 40 },
      queueWait: { count: 1, medianMs: 5 },
      refinement: { count: 1, medianMs: 10 },
      renderCall: { count: 2, medianMs: 3, p95Ms: 4 },
      sampleCount: 1,
      sort: { count: 1, medianMs: 8 },
      sparkUpdate: { count: 1, medianMs: 10 },
      switchingFramesPerSecond: 1000 / 33,
    });
  });
});
