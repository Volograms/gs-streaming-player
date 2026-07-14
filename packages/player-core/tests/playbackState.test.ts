import { describe, expect, it } from "vitest";

import { createInitialPlaybackState } from "../src/index.js";

describe("createInitialPlaybackState", () => {
  it("starts in a deterministic idle state", () => {
    expect(createInitialPlaybackState()).toEqual({
      lifecycle: "IDLE",
      currentTimeSeconds: 0,
      currentFrameIndex: 0,
      playbackRate: 1,
      isPlaying: false,
      bufferAheadSeconds: 0,
      minimumReadyFrames: 1,
    });
  });
});
