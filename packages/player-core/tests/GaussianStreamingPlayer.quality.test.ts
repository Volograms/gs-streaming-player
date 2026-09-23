import { afterEach, describe, expect, it, vi } from "vitest";

import { GaussianStreamingPlayer } from "../src/index.js";

import type {
  GaussianRendererAdapter,
  GaussianSequenceManifest,
  PreparedFrame,
  QualityDecision,
} from "../src/index.js";

let player: GaussianStreamingPlayer | undefined;
afterEach(() => {
  player?.dispose();
  player = undefined;
  vi.useRealTimers();
});

async function harness(frameRate: number) {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  let fetchDelay = 10;
  let renderFps = 90;
  let lastDecision: QualityDecision | undefined;
  const decisions: number[] = [];
  const presented: number[] = [];
  const prepared = new Set<PreparedFrame>();
  let maximumPrepared = 0;
  const quality = (frame: PreparedFrame) => ({
    detailLevel: frame.transferQuality!.detailLevel,
    selectedSplatCount: 1_000,
    state: "presentable" as const,
  });
  const renderer: GaussianRendererAdapter = {
    initialise: async () => undefined,
    dispose: () => undefined,
    canPrepareCompressedFrame: () => true,
    prepareFrame: async (sequenceId, source, options) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      const frame: PreparedFrame = {
        sequenceId,
        frameIndex: source.frameIndex,
        source,
        qualityLevel: options.transferQuality!.level,
        transferQuality: options.transferQuality!,
        rendererResource: {},
      };
      prepared.add(frame);
      maximumPrepared = Math.max(maximumPrepared, prepared.size);
      return frame;
    },
    presentFrame: (frame) => {
      presented.push(frame.transferQuality!.detailLevel);
    },
    getFramePresentationQuality: quality,
    refineFrame: async (frame) => quality(frame),
    releaseFrame: (frame) => {
      prepared.delete(frame);
    },
    hideFrame: () => undefined,
    loadMesh: async (object) => ({ id: object.id, kind: "mesh" }),
    loadStaticObject: async (object) => ({ id: object.id, kind: "static-splat" }),
    releaseObject: () => undefined,
    setFrameRefinement: () => undefined,
    setFrameTransform: () => undefined,
    setObjectTransform: () => undefined,
    setObjectVisibility: () => undefined,
    setRenderQuality: (decision) => {
      lastDecision = decision;
      decisions.push(decision.dynamicFrameDetailLevel!);
    },
    getMetrics: () => ({
      failedResourceLoadCount: 0,
      loadedMeshObjectCount: 0,
      loadedStaticObjectCount: 0,
      loadingResourceCount: 0,
      preparedFrameCount: prepared.size,
      resources: [],
      renderFramesPerSecond: renderFps,
    }),
  };
  const manifest: GaussianSequenceManifest = {
    version: "1.0",
    id: "quality",
    staticObjects: [],
    frameCount: 600,
    frameRate,
    durationSeconds: 600 / frameRate,
    dynamicSequences: [
      {
        id: "actor",
        frameCount: 600,
        frameRate,
        frames: Array.from({ length: 600 }, (_, frameIndex) => ({
          frameIndex,
          timestampSeconds: frameIndex / frameRate,
          codec: "sog",
          url: `/${frameIndex}-10000.sog`,
          qualityLevels: [0.1, 0.25, 0.5, 1].map((detailLevel, level) => ({
            level,
            detailLevel,
            minimumPlayable: level === 1,
            byteSize: detailLevel * 10_000,
            url: `/${frameIndex}-${detailLevel * 10_000}.sog`,
          })),
        })),
      },
    ],
  };
  const creating = GaussianStreamingPlayer.create({
    manifest,
    renderer,
    buffer: { compressedBufferMaximumBytes: 200_000 },
    fetch: vi.fn(async (input) => {
      const byteCount = Number(String(input).match(/-(\d+)\.sog$/)![1]);
      await new Promise<void>((resolve) => setTimeout(resolve, fetchDelay));
      return new Response(new Uint8Array(byteCount));
    }),
  });
  await vi.advanceTimersByTimeAsync(50);
  player = await creating;
  return {
    player,
    decisions,
    presented,
    get lastDetail() {
      return lastDecision?.dynamicFrameDetailLevel;
    },
    get maximumPrepared() {
      return maximumPrepared;
    },
    setFetchDelay: (delay: number) => {
      fetchDelay = delay;
    },
    setRenderFps: (fps: number) => {
      renderFps = fps;
    },
  };
}

describe("GaussianStreamingPlayer automatic quality", () => {
  it.each([25, 30])(
    "presents full tiers at %i fps, reduces quality on a slow link, and recovers",
    async (fps) => {
      const result = await harness(fps);
      await result.player.play();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.decisions).toContain(0.5);
      expect(result.lastDetail).toBe(1);
      expect(result.presented).toContain(1);
      expect(result.player.snapshot.droppedFrameCount).toBe(0);
      result.player.pause();
      await result.player.play();
      await vi.advanceTimersByTimeAsync(100);
      expect(result.lastDetail).toBe(1);
      result.setFetchDelay(250);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(result.lastDetail).toBe(0.25);
      result.setFetchDelay(10);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.lastDetail).toBe(1);
      expect(result.player.snapshot.error).toBeUndefined();
      expect(result.maximumPrepared).toBeLessThanOrEqual(14);
      expect(Math.min(...result.decisions)).toBe(0.25);
    },
  );

  it("keeps manual quality fixed and resumes adaptation when automatic is restored", async () => {
    const result = await harness(30);
    result.player.setQualityMode({ mode: "manual", detailLevel: 0.5 });
    await result.player.play();
    const automaticCalls = result.decisions.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(result.decisions).toHaveLength(automaticCalls);
    expect(result.presented.slice(-10)).toEqual(Array(10).fill(0.5));
    result.player.setQualityMode({ mode: "automatic" });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(result.lastDetail).toBe(1);
    result.setRenderFps(15);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(result.lastDetail).toBeLessThan(1);
    expect(result.player.snapshot.error).toBeUndefined();
  });
});
