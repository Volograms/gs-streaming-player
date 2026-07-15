import { describe, expect, it } from "vitest";

import {
  BufferAwareQualityController,
  createInitialPlaybackState,
} from "../src/index.js";

const network = {
  estimatedThroughputBps: 1_000_000_000,
  source: "client-measured" as const,
  timestampMs: 0,
};

const metrics = {
  downloadedBytes: 0,
  droppedFrames: 0,
  estimatedBaseFrameBytes: 1_300_000,
  renderFramesPerSecond: 60,
  stallDurationSeconds: 0,
  targetFramesPerSecond: 30,
};

describe("BufferAwareQualityController", () => {
  it("downgrades immediately on buffer risk and upgrades only after hysteresis", () => {
    const controller = new BufferAwareQualityController({
      dynamicObjectId: "actor",
      upgradeObservationCount: 2,
    });
    const initial = createInitialPlaybackState();

    const critical = controller.update(
      { ...initial, bufferAheadSeconds: 0.01, lifecycle: "BUFFERING" },
      network,
      metrics,
    );
    expect(controller.tier).toBe("critical");
    expect(critical).toMatchObject({
      allowStaticRefinement: false,
      dynamicFrameDetailLevel: 0.1,
      maximumBasePreparationConcurrency: 1,
    });

    const healthyPlayback = {
      ...initial,
      bufferAheadSeconds: 0.5,
      lifecycle: "PLAYING" as const,
    };
    controller.update(healthyPlayback, network, metrics);
    expect(controller.tier).toBe("critical");
    const upgraded = controller.update(healthyPlayback, network, metrics);
    expect(controller.tier).toBe("high");
    expect(upgraded).toMatchObject({
      dynamicFrameDetailLevel: 0.4,
      maximumRefinementConcurrency: 2,
    });
  });

  it("uses safe throughput relative to the measured base-frame demand", () => {
    const controller = new BufferAwareQualityController({
      dynamicObjectId: "actor",
      upgradeObservationCount: 1,
    });
    const decision = controller.update(
      {
        ...createInitialPlaybackState(),
        bufferAheadSeconds: 0.2,
        lifecycle: "PLAYING",
      },
      { ...network, estimatedThroughputBps: 100_000_000 },
      metrics,
    );

    expect(controller.tier).toBe("constrained");
    expect(decision.dynamicFrameDetailLevel).toBe(0.15);
  });
});
