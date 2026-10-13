import { afterEach, describe, expect, it, vi } from "vitest";

import { ExplainerController } from "./ExplainerController.js";
import { ExplainerScene } from "./ExplainerScene.js";

import type { ExplainerAssets } from "./explainerAssets.js";
import type { ExplainerSceneConfig } from "./explainerSceneConfig.js";
import type { GaussianStreamingPlayer } from "@6g-path/gaussian-player";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

vi.mock("./ExplainerScene.js", () => ({ ExplainerScene: { create: vi.fn() } }));
vi.mock("./explainerAssets.js", () => ({
  loadSparsePoints: vi.fn(async () => ({})),
  loadEllipsoids: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe("ExplainerController diagnostics", () => {
  it("separates updates from drawing and restores the current cue after a freeze", async () => {
    const scene = { apply: vi.fn(), dispose: vi.fn() };
    vi.mocked(ExplainerScene.create).mockResolvedValue(
      scene as unknown as ExplainerScene,
    );
    let tick = () => {};
    const off = vi.fn();
    const adapter = {
      application: {
        on: (_: string, listener: () => void) => {
          tick = listener;
        },
        off,
      },
    } as unknown as PlayCanvasGaussianRendererAdapter;
    let time = 30;
    const readSnapshot = vi.fn(() => ({
      currentFrameIndex: Math.floor(time * 30),
      currentTimeSeconds: time,
      durationSeconds: 132.2,
      renderer: {},
    }));
    const player = {
      sequence: {
        frameRate: 30,
        frames: Array.from({ length: 3966 }, (_, i) => ({ timestampSeconds: i / 30 })),
      },
      get snapshot() {
        return readSnapshot();
      },
    } as unknown as GaussianStreamingPlayer;
    const assets = {
      checkpoints: [0, 50, 100, 200, 300, 500, 2000, 7000, 15000, 30000].map(
        (iteration) => ({ iteration, splatCount: 1000, url: `${iteration}.sog` }),
      ),
      sparsePoints: {},
      trainingCounts: [
        { at: 0, value: 1000 },
        { at: 30000, value: 2000 },
      ],
    } as ExplainerAssets;
    const controller = await ExplainerController.create(
      adapter,
      player,
      assets,
      {} as ExplainerSceneConfig,
      undefined,
      true,
    );
    const firstFrame = scene.apply.mock.calls.at(-1)![0];
    controller.setDiagnosticMode("frozen");
    const reads = readSnapshot.mock.calls.length;
    const writes = scene.apply.mock.calls.length;
    time = 60;
    tick();
    expect(readSnapshot).toHaveBeenCalledTimes(reads);
    expect(scene.apply).toHaveBeenCalledTimes(writes);
    expect(controller.performance.snapshot.sampleCount).toBe(0);
    controller.setDiagnosticMode("hidden");
    expect(Object.values(scene.apply.mock.calls.at(-1)![1])).toEqual(
      Array(9).fill(false),
    );
    tick();
    expect(scene.apply).toHaveBeenCalledTimes(writes + 1);
    controller.setDiagnosticMode("frozen");
    expect(scene.apply.mock.calls.at(-1)![0]).toBe(firstFrame);
    expect(scene.apply.mock.calls.at(-1)![1]).toBe(controller.toggles);
    controller.setDiagnosticMode("live");
    expect(controller.debugInfo.timeSeconds).toBe(60);
    expect(scene.apply.mock.calls.at(-1)![0]).not.toBe(firstFrame);
    for (let i = 0; i < 150; i++) tick();
    expect(controller.performance.snapshot.sampleCount).toBe(120);
    controller.setDiagnosticMode("frozen");
    controller.dispose();
    expect(off).toHaveBeenCalledWith("update", tick);
    expect(scene.dispose).toHaveBeenCalledOnce();
    const disposedWrites = scene.apply.mock.calls.length;
    tick();
    controller.refresh();
    controller.setDiagnosticMode("hidden");
    expect(scene.apply).toHaveBeenCalledTimes(disposedWrites);
  });
});
