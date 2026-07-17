import { describe, expect, it } from "vitest";

import { PlaybackTraceBuffer } from "../src/PlaybackTraceBuffer.js";

import type { FrameRingBufferTraceEvent } from "@6g-path/gaussian-player";

function event(frameIndex: number): FrameRingBufferTraceEvent {
  return {
    atMs: frameIndex,
    frameIndex,
    type: "base-requested",
  };
}

describe("PlaybackTraceBuffer", () => {
  it("retains the newest events in chronological order", () => {
    const buffer = new PlaybackTraceBuffer(3);

    buffer.append(event(0));
    buffer.append(event(1));
    buffer.append(event(2));
    buffer.append(event(3));

    expect(buffer.snapshot().map(({ frameIndex }) => frameIndex)).toEqual([1, 2, 3]);
  });

  it("clears its bounded history and advances its version", () => {
    const buffer = new PlaybackTraceBuffer(2);
    buffer.append(event(0));
    const populatedVersion = buffer.version;

    buffer.clear();

    expect(buffer.snapshot()).toEqual([]);
    expect(buffer.version).toBeGreaterThan(populatedVersion);
  });

  it("rejects invalid capacities", () => {
    expect(() => new PlaybackTraceBuffer(0)).toThrow(RangeError);
  });
});
