import { describe, expect, it } from "vitest";

import { summariseFrameTimings } from "../src/index.js";

import type { FrameRingBufferTraceEvent } from "../src/index.js";

describe("summariseFrameTimings", () => {
  it("reports queue, renderer, refinement, handoff, throughput, and switching timing", () => {
    const events: FrameRingBufferTraceEvent[] = [
      { atMs: 0, durationMs: 5, frameIndex: 0, type: "base-started" },
      {
        atMs: 10,
        durationMs: 25,
        frameIndex: 0,
        loadedBytes: 1_000,
        totalBytes: 1_000,
        type: "compressed-fetch-ready",
      },
      {
        atMs: 18,
        codecId: "spz-v4",
        durationMs: 8,
        frameIndex: 0,
        type: "codec-decode-ready",
      },
      {
        atMs: 18.5,
        durationMs: 18.5,
        frameIndex: 0,
        phase: "flat-pack",
        stageDurationMs: 4,
        type: "renderer-phase",
      },
      {
        atMs: 19,
        durationMs: 19,
        frameIndex: 0,
        phase: "flat-decode",
        stageDurationMs: 9,
        type: "renderer-phase",
      },
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
        displayCommitIntervalsMs: [32, 34],
        flatFrameCopySamplesMs: [2],
        renderCallSamplesMs: [3, 4],
        renderIntervalSamplesMs: [16, 17],
        sortOrderingUploadSamplesMs: [1],
        sortReadbackSamplesMs: [5],
        sortSamplesMs: [8],
        sortWorkerSamplesMs: [2],
        sparkUpdateSamplesMs: [10],
        type: "render-timing",
      },
    ];

    expect(summariseFrameTimings(events)).toMatchObject({
      basePreparation: { count: 1, medianMs: 25, p95Ms: 25 },
      codecDecode: { count: 1, medianMs: 8 },
      compressedFetch: { count: 1, medianMs: 25 },
      compressedFetchThroughputBps: 320_000,
      displayCommitCadence: { count: 2, medianMs: 32, p95Ms: 34 },
      displayCommitFramesPerSecond: 1000 / 33,
      estimatedBaseThroughputBps: 320_000,
      flatFrameCopy: { count: 1, medianMs: 2 },
      flatPack: { count: 1, medianMs: 4 },
      flatDecode: { count: 1, medianMs: 9 },
      handoff: { count: 2, maximumMs: 1 },
      minimumRenderable: { count: 1, medianMs: 20 },
      presentationCadence: { count: 1, medianMs: 33 },
      presentationWait: { count: 2, maximumMs: 40 },
      queueWait: { count: 1, medianMs: 5 },
      refinement: { count: 1, medianMs: 10 },
      renderCall: { count: 2, medianMs: 3, p95Ms: 4 },
      sampleCount: 1,
      sort: { count: 1, medianMs: 8 },
      sortOrderingUpload: { count: 1, medianMs: 1 },
      sortReadback: { count: 1, medianMs: 5 },
      sortWorker: { count: 1, medianMs: 2 },
      sparkUpdate: { count: 1, medianMs: 10 },
      switchingFramesPerSecond: 1000 / 33,
    });
  });
});
