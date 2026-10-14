import { afterEach, describe, expect, it, vi } from "vitest";

import { BufferAwareQualityController, GaussianStreamingPlayer } from "../src/index.js";

import type {
  GaussianRendererAdapter,
  GaussianSequenceManifest,
  GaussianStreamingPlayerBufferOptions,
  PreparedFrame,
  QualityDecision,
} from "../src/index.js";

let player: GaussianStreamingPlayer | undefined;
afterEach(() => {
  player?.dispose();
  player = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function harness(
  frameRate: number,
  detailLevels = [0.1, 0.25, 0.5, 1],
  missing: { details: readonly number[]; status: number; fullDelayMs?: number } = {
    details: [],
    status: 404,
  },
  bufferOptions: GaussianStreamingPlayerBufferOptions = {},
) {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  const qualityUpdates = vi.spyOn(BufferAwareQualityController.prototype, "update");
  let fetchDelay = 10;
  let renderFps = 90;
  let preparationDelay = 1;
  let presentationDelay = 0;
  let lastDecision: QualityDecision | undefined;
  const decisions: number[] = [];
  const presented: number[] = [];
  const prepared = new Set<PreparedFrame>();
  let maximumPrepared = 0;
  let activePreparations = 0;
  let maximumActivePreparations = 0;
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
      activePreparations += 1;
      maximumActivePreparations = Math.max(
        maximumActivePreparations,
        activePreparations,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, preparationDelay));
      activePreparations -= 1;
      const frame: PreparedFrame = {
        estimatedMemoryBytes: (source.byteSize ?? 0) * 8,
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
    presentFrame: async (frame) => {
      if (presentationDelay > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, presentationDelay));
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
          qualityLevels: detailLevels.map((detailLevel, level) => ({
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
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const byteCount = Number(String(input).match(/-(\d+)\.sog$/)![1]);
    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        byteCount === 10_000 ? (missing.fullDelayMs ?? fetchDelay) : fetchDelay,
      ),
    );
    if (missing.details.includes(byteCount / 10_000)) {
      return new Response(null, { status: missing.status });
    }
    return new Response(new Uint8Array(byteCount));
  });
  const creating = GaussianStreamingPlayer.create({
    manifest,
    renderer,
    buffer: { compressedBufferMaximumBytes: 1_600_000, ...bufferOptions },
    fetch,
  });
  await vi.advanceTimersByTimeAsync(50);
  player = await creating;
  return {
    player,
    qualityUpdates,
    fetch,
    decisions,
    presented,
    get lastDetail() {
      return lastDecision?.dynamicFrameDetailLevel;
    },
    get maximumPrepared() {
      return maximumPrepared;
    },
    get preparedCount() {
      return prepared.size;
    },
    get maximumActivePreparations() {
      return maximumActivePreparations;
    },
    resetPreparationPeak() {
      maximumActivePreparations = activePreparations;
    },
    get preparedFrames() {
      return [...prepared];
    },
    setPresentationDelay: (delay: number) => {
      presentationDelay = delay;
    },
    setPreparationDelay: (delay: number) => {
      preparationDelay = delay;
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
  it.each([1, 2, 4])(
    "keeps the explicit %i-job preparation limit across automatic and manual quality",
    async (concurrency) => {
      const result = await harness(30, undefined, undefined, {
        maximumBasePreparationConcurrency: concurrency,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(result.lastDetail).toBe(1);
      expect(result.maximumActivePreparations).toBe(concurrency);

      result.resetPreparationPeak();
      result.player.setQualityMode({ mode: "manual", detailLevel: 0.25 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(result.maximumActivePreparations).toBe(concurrency);

      result.resetPreparationPeak();
      result.player.setQualityMode({ mode: "automatic" });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(result.lastDetail).toBe(1);
      expect(result.maximumActivePreparations).toBe(concurrency);
      expect(result.player.snapshot.error).toBeUndefined();
    },
  );

  it("lets automatic quality adjust preparation concurrency when no limit is supplied", async () => {
    const result = await harness(30);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.lastDetail).toBe(1);
    expect(result.maximumActivePreparations).toBe(3);
  });

  it("fills a five-second decoded reserve and refreshes the paused image to the best available tier", async () => {
    const result = await harness(30, undefined, { details: [1], status: 404 });
    await vi.advanceTimersByTimeAsync(1_000);
    const snapshot = result.player.snapshot;
    expect(snapshot.isPlaying).toBe(false);
    expect(snapshot.currentTimeSeconds).toBe(0);
    expect(result.presented.at(-1)).toBe(0.5);
    expect(
      result.qualityUpdates.mock.calls.at(-1)?.[2].presentedDynamicDetailLevel,
    ).toBe(0.5);
    expect(snapshot.decodedFrameCount).toBeGreaterThanOrEqual(150);
    expect(snapshot.bufferDiagnostics?.decodedAheadSeconds).toBeGreaterThanOrEqual(5);
    expect(snapshot.bufferDiagnostics?.compressedResidentBytes).toBeGreaterThan(
      1_500_000,
    );
    expect(snapshot.error).toBeUndefined();
    result.player.dispose();
    expect(result.preparedCount).toBe(0);
  });

  it("refreshes paused quality at the exact media time after a slow presentation", async () => {
    const result = await harness(30);
    result.setPresentationDelay(100);
    result.player.setQualityMode({ mode: "manual", detailLevel: 0.25 });
    await vi.advanceTimersByTimeAsync(1_000);
    await result.player.play();
    await vi.advanceTimersByTimeAsync(950);
    result.player.pause();
    const pausedTime = result.player.snapshot.currentTimeSeconds;
    expect(pausedTime).toBeGreaterThan(
      (result.player.snapshot.currentFrameIndex + 1) / 30,
    );
    result.player.setQualityMode({ mode: "automatic" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.player.snapshot.currentTimeSeconds).toBe(pausedTime);
    expect(result.player.snapshot.lifecycle).toBe("PAUSED");
    expect(result.player.snapshot.currentFrameIndex).toBe(Math.floor(pausedTime * 30));
    expect(result.presented.at(-1)).toBe(1);
    expect(result.player.snapshot.error).toBeUndefined();
    result.player.dispose();
    expect(result.preparedCount).toBe(0);
  });

  it("appends automatic upgrades behind a full decoded window without dropping its reserve", async () => {
    const result = await harness(30);
    result.player.setQualityMode({ mode: "manual", detailLevel: 0.25 });
    await vi.advanceTimersByTimeAsync(1_000);
    await result.player.play();
    await vi.advanceTimersByTimeAsync(100);
    const before = result.player.snapshot;
    const retained = result.preparedFrames;
    const oldTail = Math.max(...retained.map((frame) => frame.frameIndex));
    const presentationCount = result.presented.length;
    expect(before.bufferDiagnostics?.decodedAheadSeconds).toBeGreaterThanOrEqual(5);
    result.player.setQualityMode({ mode: "automatic" });
    expect(result.lastDetail).toBe(1);
    expect(result.player.snapshot.decodedFrameCount).toBe(before.decodedFrameCount);
    expect(result.player.snapshot.decodedTimeRanges).toEqual(before.decodedTimeRanges);
    for (const frame of retained) expect(result.preparedFrames).toContain(frame);
    await vi.advanceTimersByTimeAsync(1_000);
    const higher = result.preparedFrames.filter(
      (frame) => frame.transferQuality!.detailLevel === 1,
    );
    expect(higher.length).toBeGreaterThan(0);
    expect(higher.every((frame) => frame.frameIndex > oldTail)).toBe(true);
    expect(
      result.presented.slice(presentationCount).every((detail) => detail === 0.25),
    ).toBe(true);
    expect(
      result.player.snapshot.bufferDiagnostics?.decodedAheadSeconds,
    ).toBeGreaterThan(4.9);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(result.presented.slice(presentationCount)).toContain(1);
    expect(result.player.snapshot.droppedFrameCount).toBe(0);
    expect(result.player.snapshot.error).toBeUndefined();
  });

  it("fits the decoded window to its own memory budget and fills a larger compressed reserve", async () => {
    const result = await harness(30, undefined, undefined, {
      decodedBufferMaximumBytes: 800_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const buffer = result.player.snapshot.bufferDiagnostics!;
    expect(buffer.decodedResidentBytes).toBeLessThanOrEqual(800_000);
    expect(result.player.snapshot.decodedFrameCount).toBe(10);
    expect(buffer.downloadedAheadSeconds).toBeGreaterThan(5);
    expect(buffer.decodedAheadSeconds).toBeLessThan(0.5);
    result.player.setQualityMode({ mode: "manual", detailLevel: 0.5 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.presented.at(-1)).toBe(0.5);
    expect(result.player.snapshot.decodedFrameCount).toBe(20);
    expect(
      result.player.snapshot.bufferDiagnostics?.decodedResidentBytes,
    ).toBeLessThanOrEqual(800_000);
  });

  it.each([
    { detailLevels: [0.1, 0.25, 0.25, 1], floor: 0.25 },
    { detailLevels: [1, 1, 1, 1], floor: 1 },
  ])(
    "loads and plays duplicate authored details: $detailLevels",
    async ({ detailLevels, floor }) => {
      const result = await harness(30, detailLevels);
      await result.player.play();
      await vi.advanceTimersByTimeAsync(200);
      expect(result.lastDetail).toBeGreaterThanOrEqual(floor);
      expect(result.presented).toContain(floor);
      expect(Math.min(...result.decisions)).toBeGreaterThanOrEqual(floor);
      expect(result.player.snapshot.error).toBeUndefined();
    },
  );

  it.each([25, 30])(
    "presents full tiers at %i fps, reduces quality on a slow link, and recovers",
    async (fps) => {
      const result = await harness(fps);
      await result.player.play();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.lastDetail).toBe(1);
      expect(
        result.qualityUpdates.mock.calls.some(
          ([, , metrics]) => (metrics.compressedBufferAheadSeconds ?? 0) > 5,
        ),
      ).toBe(true);
      expect(result.presented).toContain(1);
      expect(result.player.snapshot.droppedFrameCount).toBe(0);
      result.player.pause();
      await result.player.play();
      await vi.advanceTimersByTimeAsync(100);
      expect(result.lastDetail).toBe(1);
      result.setFetchDelay(500);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.lastDetail).toBeLessThan(1);
      result.setFetchDelay(10);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.lastDetail).toBe(1);
      expect(result.player.snapshot.error).toBeUndefined();
      expect(result.maximumPrepared).toBeLessThanOrEqual(fps * 5 + 4);
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

  it("recovers from Preview when fixed preparation overhead understates the next tier's capacity", async () => {
    const result = await harness(30, [0.1, 0.1, 0.2, 0.33], undefined, {
      loop: true,
    });
    result.setPreparationDelay(50);
    result.setRenderFps(15);
    await result.player.play();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(result.lastDetail).toBe(0.1);
    result.setRenderFps(60);
    const beforeRecovery = result.presented.length;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(result.presented.slice(beforeRecovery)).toContain(0.2);
    expect(result.lastDetail).toBeGreaterThanOrEqual(0.2);
    expect(result.player.snapshot.isPlaying).toBe(true);
    expect(result.player.snapshot.error).toBeUndefined();
  });

  it.each([404, 410])(
    "uses the highest available tier when full assets return %i, without retrying them every frame",
    async (status) => {
      const result = await harness(30, undefined, { details: [1], status });
      await result.player.play();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(result.lastDetail).toBe(0.5);
      expect(result.player.snapshot.error).toBeUndefined();
      expect(result.player.snapshot.droppedFrameCount).toBe(0);
      const fullRequests = () =>
        result.fetch.mock.calls.filter(([url]) => String(url).endsWith("-10000.sog"))
          .length;
      const attempts = fullRequests();
      expect(attempts).toBeGreaterThan(0);
      expect(attempts).toBeLessThanOrEqual(6);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(fullRequests()).toBe(attempts);
      expect(result.lastDetail).toBe(0.5);
      // The higher tier appears after the preserved startup window is consumed.
      expect(result.presented.slice(-10)).toEqual(Array(10).fill(0.5));
    },
  );

  it("keeps the highest sustainable tier while its larger downloaded reserve fills", async () => {
    const result = await harness(30, undefined, {
      details: [],
      status: 404,
      fullDelayMs: 90,
    });
    await result.player.play();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(result.lastDetail).toBe(1);
    const decisionCount = result.decisions.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.decisions.slice(decisionCount).every((detail) => detail === 1)).toBe(
      true,
    );
    expect(result.player.snapshot.droppedFrameCount).toBe(0);
    expect(result.player.snapshot.error).toBeUndefined();
  });

  it("falls back from a missing manual tier and a missing initial floor without using Preview", async () => {
    const result = await harness(30, undefined, { details: [0.25, 1], status: 404 });
    result.player.setQualityMode({ mode: "manual", detailLevel: 1 });
    await result.player.play();
    await vi.advanceTimersByTimeAsync(500);
    expect(result.presented.slice(-5)).toEqual(Array(5).fill(0.5));
    expect(result.presented).not.toContain(0.1);
    expect(result.player.snapshot.error).toBeUndefined();
  });
});
