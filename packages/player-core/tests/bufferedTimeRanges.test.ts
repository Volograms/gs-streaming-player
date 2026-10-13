import { describe, expect, it } from "vitest";

import {
  bufferedTimeRanges,
  decodedTimeRanges,
} from "../src/buffering/bufferedTimeRanges.js";

import type {
  BufferedFrameStatus,
  DynamicGaussianSequence,
  FrameRingBufferSnapshot,
} from "../src/index.js";

const sequence: DynamicGaussianSequence = {
  id: "actor",
  frameCount: 6,
  frameRate: 5,
  frames: [0.2, 0.4, 0.8, 1.1, 1.5, 2].map((timestampSeconds, frameIndex) => ({
    frameIndex,
    timestampSeconds,
    url: `/${frameIndex}.sog`,
  })),
};

function snapshot(
  cached: number[],
  prepared: [number, BufferedFrameStatus][] = [],
): FrameRingBufferSnapshot {
  return {
    activeBasePreparationCount: 0,
    capacity: 4,
    futureFrameCount: 2,
    previousFrameCount: 1,
    queuedBasePreparationCount: 0,
    frames: prepared.map(([frameIndex, status]) => ({
      deadlineMs: 0,
      downloadedBytes: 0,
      frameIndex,
      qualityLevel: 1,
      requestedBytes: 0,
      status,
      targetQualityLevel: 1,
      timestampSeconds: sequence.frames[frameIndex]!.timestampSeconds,
    })),
    compressedBuffer: {
      activeFetchCount: 0,
      capacityBytes: 100,
      contiguousReadyFrameCount: 0,
      queuedFetchCount: 0,
      readyFrameCount: cached.length,
      readyFrameIndices: cached,
      residentBytes: cached.length,
    },
  };
}

describe("bufferedTimeRanges", () => {
  it("separates completed decoded frames from downloads and unfinished preparation", () => {
    const state = snapshot(
      [0, 1, 2, 3, 4, 5],
      [
        [0, "presented"],
        [1, "ready"],
        [2, "base-ready"],
        [3, "refining"],
        [4, "ready"],
        [5, "loading-base"],
      ],
    );
    expect(bufferedTimeRanges(state, sequence, 2.2)).toEqual([
      { startSeconds: 0, endSeconds: 2.2 },
    ]);
    expect(decodedTimeRanges(state, sequence, 2.2)).toEqual([
      { startSeconds: 0, endSeconds: 0.8 },
      { startSeconds: 1.5, endSeconds: 2 },
    ]);
    expect(decodedTimeRanges(snapshot([0, 1, 2]), sequence, 2.2)).toEqual([]);
  });

  it("merges downloaded and prepared frames using authored times without hiding gaps", () => {
    expect(
      bufferedTimeRanges(
        snapshot(
          [5, 1, 0, 1],
          [
            [2, "ready"],
            [3, "loading-base"],
            [4, "failed"],
          ],
        ),
        sequence,
        2.2,
      ),
    ).toEqual([
      { startSeconds: 0, endSeconds: 1.1 },
      { startSeconds: 2, endSeconds: 2.2 },
    ]);
  });

  it("keeps cached content across a loop boundary in two timeline ranges", () => {
    expect(bufferedTimeRanges(snapshot([5, 0]), sequence, 2.2)).toEqual([
      { startSeconds: 0, endSeconds: 0.4 },
      { startSeconds: 2, endSeconds: 2.2 },
    ]);
  });

  it("drops expired content and supports prepared frames without compressed caching", () => {
    const state = snapshot(
      [],
      [
        [2, "expired"],
        [3, "presented"],
        [4, "ready"],
      ],
    );
    delete state.compressedBuffer;
    expect(bufferedTimeRanges(state, sequence, 2.2)).toEqual([
      { startSeconds: 1.1, endSeconds: 2 },
    ]);
    expect(bufferedTimeRanges(snapshot([]), sequence, 2.2)).toEqual([]);
  });
});
