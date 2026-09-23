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
  it.each([
    [{ minimumSplatCount: 0 }, "minimumSplatCount"],
    [{ minimumSplatCount: 1.5 }, "minimumSplatCount"],
    [{ targetBufferSeconds: 0 }, "targetBufferSeconds"],
    [{ targetBufferSeconds: Number.POSITIVE_INFINITY }, "targetBufferSeconds"],
    [{ upgradeObservationCount: 0 }, "upgradeObservationCount"],
    [{ upgradeObservationCount: 1.5 }, "upgradeObservationCount"],
  ])("rejects invalid quality configuration %o", (configuration, field) => {
    expect(
      () =>
        new BufferAwareQualityController({
          dynamicObjectId: "actor",
          ...configuration,
        }),
    ).toThrow(field);
  });

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

  it("keeps an application-defined dynamic transfer floor during buffer pressure", () => {
    const controller = new BufferAwareQualityController({
      dynamicObjectId: "actor",
      minimumDynamicDetailLevel: 0.25,
    });
    const decision = controller.update(
      {
        ...createInitialPlaybackState(),
        bufferAheadSeconds: 0,
        lifecycle: "BUFFERING",
      },
      network,
      metrics,
    );

    expect(controller.tier).toBe("critical");
    expect(decision.dynamicFrameDetailLevel).toBe(0.25);
  });

  describe("authored transfer tiers", () => {
    function controller() {
      return new BufferAwareQualityController({
        dynamicObjectId: "actor",
        dynamicQualityLevels: [
          { detailLevel: 0.25, estimatedFrameBytes: 650_000 },
          { detailLevel: 0.5, estimatedFrameBytes: 1_250_000 },
          { detailLevel: 1, estimatedFrameBytes: 2_400_000 },
        ],
        targetBufferSeconds: 10 / 30,
      });
    }
    const playing = {
      ...createInitialPlaybackState(),
      bufferAheadSeconds: 9 / 30,
      isPlaying: true,
      lifecycle: "PLAYING" as const,
    };
    const observation = (timestampMs: number, fps = 30) => ({
      ...metrics,
      timestampMs,
      bufferCapacitySeconds: 10 / fps,
      targetFramesPerSecond: fps,
    });

    it.each([25, 30])(
      "reaches full quality at %i fps with the default ten-frame window",
      (fps) => {
        const policy = controller();
        const playback = { ...playing, bufferAheadSeconds: 9 / fps };
        const details = [];
        for (let now = 0; now <= 5_000; now += 250) {
          details.push(
            policy.update(playback, network, observation(now, fps))
              .dynamicFrameDetailLevel,
          );
        }
        expect(details[0]).toBe(0.25);
        expect(details).toContain(0.5);
        expect(details.at(-1)).toBe(1);
      },
    );

    it("does not let repeated callbacks or paused time satisfy upgrade hysteresis", () => {
      const policy = controller();
      for (let index = 0; index < 30; index += 1) {
        expect(
          policy.update(playing, network, observation(0)).dynamicFrameDetailLevel,
        ).toBe(0.25);
      }
      policy.update(
        { ...playing, isPlaying: false, lifecycle: "PAUSED" },
        network,
        observation(1_000),
      );
      expect(
        policy.update(playing, network, observation(10_000)).dynamicFrameDetailLevel,
      ).toBe(0.25);
      expect(
        policy.update(playing, { ...network, confidence: 0 }, observation(20_000))
          .dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("uses candidate bytes, immediately downgrades a slow link, then recovers gradually", () => {
      const policy = controller();
      for (let now = 0; now <= 5_000; now += 250)
        policy.update(playing, network, observation(now));
      const slow = { ...network, estimatedThroughputBps: 250_000_000 };
      expect(
        policy.update(playing, slow, observation(5_250)).dynamicFrameDetailLevel,
      ).toBe(0.25);
      for (let now = 5_500; now < 7_500; now += 250) {
        expect(
          policy.update(playing, network, observation(now)).dynamicFrameDetailLevel,
        ).toBe(0.25);
      }
      expect(
        policy.update(playing, network, observation(7_500)).dynamicFrameDetailLevel,
      ).toBe(0.5);
    });

    it("responds to presentation overload and buffer starvation without crossing the floor", () => {
      const policy = controller();
      for (let now = 0; now <= 5_000; now += 250)
        policy.update(playing, network, observation(now));
      for (let now = 5_250; now <= 6_000; now += 250) {
        policy.update(playing, network, {
          ...observation(now),
          renderFramesPerSecond: 20,
        });
      }
      expect(
        policy.update(playing, network, {
          ...observation(6_250),
          renderFramesPerSecond: 20,
        }).dynamicFrameDetailLevel,
      ).toBe(0.5);
      expect(
        policy.update(
          { ...playing, lifecycle: "BUFFERING", bufferAheadSeconds: 0 },
          network,
          observation(6_500),
        ).dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("fits a smaller configured window and holds tiers with unknown byte cost", () => {
      const policy = controller();
      let decision;
      for (let now = 0; now <= 5_000; now += 250)
        decision = policy.update({ ...playing, bufferAheadSeconds: 2 / 30 }, network, {
          ...observation(now),
          bufferCapacitySeconds: 2 / 30,
        });
      expect(decision?.dynamicFrameDetailLevel).toBe(1);
      const unknown = new BufferAwareQualityController({
        dynamicObjectId: "actor",
        dynamicQualityLevels: [{ detailLevel: 0.25 }, { detailLevel: 1 }],
      });
      for (let now = 0; now <= 5_000; now += 250) {
        expect(
          unknown.update(playing, network, observation(now)).dynamicFrameDetailLevel,
        ).toBe(0.25);
      }
    });
  });
});
