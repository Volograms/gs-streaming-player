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
        expect(details.at(-1)).toBe(1);
      },
    );

    it("requires elapsed playback evidence but prepares the best available quality while paused", () => {
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
      ).toBe(1);
      expect(
        policy.update(playing, { ...network, confidence: 0 }, observation(20_000))
          .dynamicFrameDetailLevel,
      ).toBe(1);
    });

    it("tries the next tier on a slow link, then selects the highest sustainable tier", () => {
      const policy = controller();
      for (let now = 0; now <= 5_000; now += 250)
        policy.update(playing, network, observation(now));
      const slow = { ...network, estimatedThroughputBps: 250_000_000 };
      expect(
        policy.update(playing, slow, observation(5_250)).dynamicFrameDetailLevel,
      ).toBe(0.5);
      for (let now = 5_500; now < 7_500; now += 250) {
        expect(
          policy.update(playing, network, observation(now)).dynamicFrameDetailLevel,
        ).toBe(0.5);
      }
      expect(
        policy.update(playing, network, observation(7_500)).dynamicFrameDetailLevel,
      ).toBe(1);
    });

    it("upgrades while the reserve fills and limits quality by the five-second memory budget", () => {
      const policy = new BufferAwareQualityController({
        dynamicObjectId: "actor",
        dynamicQualityLevels: [
          { detailLevel: 0.25, estimatedFrameBytes: 650_000 },
          { detailLevel: 0.5, estimatedFrameBytes: 1_250_000 },
          { detailLevel: 1, estimatedFrameBytes: 2_400_000 },
        ],
        targetBufferSeconds: 5,
      });
      const observe = (now: number, reserve: number) =>
        policy.update(playing, network, {
          ...observation(now),
          compressedBufferAheadSeconds: reserve,
          compressedBufferCapacityBytes: 200_000_000,
          compressedBufferWindowSeconds: 60,
        });
      for (let now = 0; now <= 3_000; now += 250) observe(now, 1);
      expect(observe(3_000, 1).dynamicFrameDetailLevel).toBe(0.5);
      for (let now = 3_250; now <= 5_500; now += 250) observe(now, 5);
      // Full fits the link, but five seconds would exceed the cache's 200 MB budget.
      expect(observe(5_750, 5).dynamicFrameDetailLevel).toBe(0.5);
      expect(observe(7_000, 0.1).dynamicFrameDetailLevel).toBe(0.25);
    });

    it("allows the highest tier for a fully buffered short looping clip", () => {
      const policy = new BufferAwareQualityController({
        dynamicObjectId: "actor",
        dynamicQualityLevels: [
          { detailLevel: 0.25, estimatedFrameBytes: 10 },
          { detailLevel: 1, estimatedFrameBytes: 20 },
        ],
        targetBufferSeconds: 5,
      });
      let decision;
      for (let now = 0; now <= 2_500; now += 250) {
        decision = policy.update(playing, network, {
          ...observation(now),
          compressedBufferAheadSeconds: 1,
          compressedBufferCapacityBytes: 600,
          compressedBufferWindowSeconds: 1,
        });
      }
      expect(decision?.dynamicFrameDetailLevel).toBe(1);
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
      ).toBe(0.5);
      expect(
        policy.update(
          { ...playing, lifecycle: "BUFFERING", bufferAheadSeconds: 0 },
          network,
          observation(8_000),
        ).dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("gives the next tier a recovery window without starving preparation slots", () => {
      const policy = controller();
      policy.update(
        { ...playing, isPlaying: false, lifecycle: "PAUSED" },
        network,
        observation(0),
      );
      const starving = { ...playing, bufferAheadSeconds: 0 };
      expect(policy.update(starving, network, observation(100))).toMatchObject({
        dynamicFrameDetailLevel: 0.5,
        maximumBasePreparationConcurrency: 2,
      });
      for (let now = 350; now < 2_100; now += 250) {
        expect(
          policy.update(starving, network, observation(now)).dynamicFrameDetailLevel,
        ).toBe(0.5);
      }
      // Recovery at the intermediate tier must prevent a second downgrade.
      expect(
        policy.update(playing, network, observation(2_100)).dynamicFrameDetailLevel,
      ).toBe(0.5);
      // If it later starves again, take one further step, respecting the floor.
      expect(
        policy.update(starving, network, observation(2_350)).dynamicFrameDetailLevel,
      ).toBe(0.25);
      expect(
        policy.update(starving, network, observation(5_000)).dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("skips unavailable tiers when stepping down", () => {
      const policy = controller();
      const available = { ...observation(0), availableDynamicDetailLevels: [0.25, 1] };
      policy.update(
        { ...playing, isPlaying: false, lifecycle: "PAUSED" },
        network,
        available,
      );
      expect(
        policy.update({ ...playing, bufferAheadSeconds: 0 }, network, {
          ...available,
          timestampMs: 100,
        }).dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("does not blame the new tier for drops while retained higher-tier frames are displayed", () => {
      const policy = controller();
      policy.update(
        { ...playing, isPlaying: false, lifecycle: "PAUSED" },
        network,
        observation(0),
      );
      expect(
        policy.update({ ...playing, bufferAheadSeconds: 0 }, network, {
          ...observation(100),
          presentedDynamicDetailLevel: 1,
        }).dynamicFrameDetailLevel,
      ).toBe(0.5);
      for (let now = 350; now <= 5_100; now += 250) {
        expect(
          policy.update(playing, network, {
            ...observation(now),
            presentedDynamicDetailLevel: 1,
            renderFramesPerSecond: 20,
            droppedFrames: Math.floor(now / 50),
          }).dynamicFrameDetailLevel,
        ).toBe(0.5);
      }
      // Ignore the interval straddling the first displayed lower-tier frame. Its
      // measured ratio may be slightly above the authored tier's minimum ratio.
      expect(
        policy.update(playing, network, {
          ...observation(5_350),
          presentedDynamicDetailLevel: 0.5002,
          droppedFrames: 107,
        }).dynamicFrameDetailLevel,
      ).toBe(0.5);
      // Sustained loss observed at the actual new tier can trigger another step.
      expect(
        policy.update(playing, network, {
          ...observation(5_600),
          presentedDynamicDetailLevel: 0.5002,
          droppedFrames: 112,
        }).dynamicFrameDetailLevel,
      ).toBe(0.25);
    });

    it("waits for an appended higher tier to reach the screen before judging its render cost", () => {
      const policy = controller();
      for (let now = 0; now <= 2_000; now += 250)
        policy.update(playing, network, {
          ...observation(now),
          presentedDynamicDetailLevel: 0.25,
        });
      for (let now = 2_250; now <= 7_500; now += 250) {
        expect(
          policy.update(playing, network, {
            ...observation(now),
            presentedDynamicDetailLevel: 0.2502,
            renderFramesPerSecond: 20,
            droppedFrames: Math.floor(now / 50),
          }).dynamicFrameDetailLevel,
        ).toBe(1);
      }
      expect(
        policy.update(playing, network, {
          ...observation(7_750),
          presentedDynamicDetailLevel: 1,
          renderFramesPerSecond: 20,
          droppedFrames: 155,
        }).dynamicFrameDetailLevel,
      ).toBe(1);
      expect(
        policy.update(playing, network, {
          ...observation(8_000),
          presentedDynamicDetailLevel: 1,
          renderFramesPerSecond: 20,
          droppedFrames: 160,
        }).dynamicFrameDetailLevel,
      ).toBe(0.5);
    });

    it("upgrades despite isolated late frames, backs off for sustained loss, and recovers", () => {
      const policy = controller();
      let decision;
      for (let now = 0; now <= 4_000; now += 250) {
        decision = policy.update(playing, network, {
          ...observation(now),
          droppedFrames: Math.floor(now / 1_500),
        });
      }
      expect(decision?.dynamicFrameDetailLevel).toBe(1);
      expect(
        policy.update(playing, network, {
          ...observation(4_250),
          droppedFrames: 20,
        }).dynamicFrameDetailLevel,
      ).toBeLessThan(1);
      for (let now = 4_500; now <= 8_000; now += 250) {
        decision = policy.update(playing, network, {
          ...observation(now),
          droppedFrames: 20,
        });
      }
      expect(decision?.dynamicFrameDetailLevel).toBe(1);
    });

    it("limits a fast connection by measured preparation capacity", () => {
      const policy = controller();
      let decision;
      for (let now = 0; now <= 3_000; now += 250) {
        decision = policy.update(playing, network, {
          ...observation(now),
          estimatedPreparationBytesPerSecond: 50_000_000,
        });
      }
      expect(decision?.dynamicFrameDetailLevel).toBe(0.5);
    });

    it("does not restart upgrade observation for brief render-FPS dips", () => {
      const policy = controller();
      let decision;
      for (let now = 0; now <= 2_500; now += 250) {
        decision = policy.update(playing, network, {
          ...observation(now),
          renderFramesPerSecond: now % 1_000 === 0 ? 29 : 35,
        });
      }
      expect(decision?.dynamicFrameDetailLevel).toBe(1);
    });

    describe("recovery probes", () => {
      const recovered = { ...playing, bufferAheadSeconds: 1.5 };
      const recoveryMetrics = (timestampMs: number) => ({
        ...observation(timestampMs),
        bufferCapacitySeconds: 5,
        compressedBufferAheadSeconds: 5,
        compressedBufferCapacityBytes: 200_000_000,
        compressedBufferWindowSeconds: 60,
        availableDynamicDetailLevels: [0.1, 0.2, 0.33],
        // Preview meets this conservative prediction, but Minimum does not.
        estimatedPreparationBytesPerSecond: 20_000_000,
        presentedDynamicDetailLevel: 0.1,
      });
      function previewPolicy() {
        const policy = new BufferAwareQualityController({
          dynamicObjectId: "actor",
          targetBufferSeconds: 5,
          dynamicQualityLevels: [
            { detailLevel: 0.1, estimatedFrameBytes: 400_000 },
            { detailLevel: 0.2, estimatedFrameBytes: 750_000 },
            { detailLevel: 0.33, estimatedFrameBytes: 1_200_000 },
            { detailLevel: 1, estimatedFrameBytes: 1_800_000 },
          ],
        });
        policy.update(
          { ...recovered, isPlaying: false, lifecycle: "PAUSED" },
          network,
          recoveryMetrics(0),
        );
        const starving = { ...playing, bufferAheadSeconds: 0 };
        expect(
          policy.update(starving, network, recoveryMetrics(250))
            .dynamicFrameDetailLevel,
        ).toBe(0.2);
        expect(
          policy.update(starving, network, recoveryMetrics(2_250))
            .dynamicFrameDetailLevel,
        ).toBe(0.1);
        return policy;
      }

      it.each(["conservative preparation", "expired network"])(
        "retries Minimum after Preview recovers despite %s estimates",
        (reason) => {
          const policy = previewPolicy();
          const measured =
            reason === "expired network"
              ? { ...network, estimatedThroughputBps: 0, confidence: 0 }
              : network;
          for (let now = 2_500; now < 7_500; now += 250) {
            expect(
              policy.update(recovered, measured, recoveryMetrics(now))
                .dynamicFrameDetailLevel,
            ).toBe(0.1);
          }
          expect(
            policy.update(recovered, measured, recoveryMetrics(7_500))
              .dynamicFrameDetailLevel,
          ).toBe(0.2);
        },
      );

      it("backs off a failed probe even when speed estimates immediately improve", () => {
        const policy = previewPolicy();
        for (let now = 2_500; now <= 7_500; now += 250)
          policy.update(recovered, network, recoveryMetrics(now));
        expect(
          policy.update({ ...playing, bufferAheadSeconds: 0 }, network, {
            ...recoveryMetrics(7_750),
            presentedDynamicDetailLevel: 0.2,
          }).dynamicFrameDetailLevel,
        ).toBe(0.1);
        for (let now = 8_000; now < 17_500; now += 250) {
          expect(
            policy.update(recovered, network, {
              ...recoveryMetrics(now),
              estimatedPreparationBytesPerSecond: 200_000_000,
            }).dynamicFrameDetailLevel,
          ).toBe(0.1);
        }
        expect(
          policy.update(recovered, network, {
            ...recoveryMetrics(17_500),
            estimatedPreparationBytesPerSecond: 200_000_000,
          }).dynamicFrameDetailLevel,
        ).toBe(0.33);
      });

      it.each([
        "thin reserve",
        "draining reserve",
        "render overload",
        "presentation drops",
        "retained higher tier",
        "memory limit",
      ])("does not probe through %s", (pressure) => {
        const policy = previewPolicy();
        for (let now = 2_500; now <= 15_000; now += 250) {
          expect(
            policy.update(
              {
                ...recovered,
                bufferAheadSeconds:
                  pressure === "thin reserve"
                    ? 0.3
                    : pressure === "draining reserve"
                      ? 4 - (now - 2_500) / 5_000
                      : 1.5,
              },
              network,
              {
                ...recoveryMetrics(now),
                ...(pressure === "render overload" && { renderFramesPerSecond: 20 }),
                ...(pressure === "presentation drops" && {
                  droppedFrames: now / 50,
                }),
                ...(pressure === "retained higher tier" && {
                  presentedDynamicDetailLevel: 0.33,
                }),
                ...(pressure === "memory limit" && {
                  compressedBufferCapacityBytes: 100_000_000,
                }),
              },
            ).dynamicFrameDetailLevel,
          ).toBe(0.1);
        }
      });

      it("skips missing tiers on recovery and still respects the memory budget", () => {
        const policy = previewPolicy();
        let decision;
        for (let now = 2_500; now <= 7_500; now += 250) {
          decision = policy.update(recovered, network, {
            ...recoveryMetrics(now),
            availableDynamicDetailLevels: [0.1, 0.33],
          });
        }
        expect(decision?.dynamicFrameDetailLevel).toBe(0.33);
      });
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
          unknown.update(playing, network, {
            ...observation(now),
            compressedBufferAheadSeconds: 5,
            compressedBufferCapacityBytes: 200_000_000,
          }).dynamicFrameDetailLevel,
        ).toBe(0.25);
      }
    });
  });
});
