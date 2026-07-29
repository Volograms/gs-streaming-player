import { describe, expect, it, vi } from "vitest";

import { GaussianStreamingPlayer } from "../src/index.js";

import type {
  FramePresentationQuality,
  GaussianRendererAdapter,
  GaussianSequenceManifest,
  GaussianStreamingMediaElement,
  PlaybackClock,
  PreparedFrame,
  RendererMetrics,
} from "../src/index.js";

const presentable: FramePresentationQuality = {
  detailLevel: 1,
  selectedSplatCount: 1_000,
  state: "presentable",
};

function manifest(sequenceCount = 1, withAudio = false): GaussianSequenceManifest {
  const sequence = (id: string) => ({
    frameCount: 3,
    frameRate: 30,
    frames: [0, 1, 2].map((frameIndex) => ({
      frameIndex,
      timestampSeconds: frameIndex / 30,
      url: `frames/${frameIndex}.sog`,
    })),
    id,
  });
  return {
    ...(withAudio ? { audio: { offsetSeconds: 0, url: "audio/track.ogg" } } : {}),
    durationSeconds: 0.1,
    dynamicSequences: Array.from({ length: sequenceCount }, (_, index) =>
      sequence(`actor-${index}`),
    ),
    frameCount: 3,
    frameRate: 30,
    id: "preview",
    meshObjects: [{ id: "marker", url: "marker.glb" }],
    staticObjects: [{ id: "room", url: "room.sog" }],
    version: "1.0",
  };
}

function renderer() {
  const prepared = new Set<PreparedFrame>();
  const metrics: RendererMetrics = {
    failedResourceLoadCount: 0,
    loadedMeshObjectCount: 0,
    loadedStaticObjectCount: 0,
    loadingResourceCount: 0,
    preparedFrameCount: 0,
    resources: [],
  };
  const value: GaussianRendererAdapter = {
    dispose: vi.fn(),
    getFramePresentationQuality: () => presentable,
    getMetrics: () => ({ ...metrics, preparedFrameCount: prepared.size }),
    hideFrame: vi.fn(),
    initialise: vi.fn(async () => undefined),
    loadMesh: vi.fn(async (object) => ({
      id: object.id,
      kind: "mesh" as const,
    })),
    loadStaticObject: vi.fn(async (object) => ({
      id: object.id,
      kind: "static-splat" as const,
    })),
    prepareFrame: vi.fn(async (sequenceId, source) => {
      const frame: PreparedFrame = {
        frameIndex: source.frameIndex,
        qualityLevel: 0,
        rendererResource: {},
        sequenceId,
        source,
      };
      prepared.add(frame);
      return frame;
    }),
    presentFrame: vi.fn(),
    refineFrame: vi.fn(async () => presentable),
    releaseFrame: vi.fn((frame) => prepared.delete(frame)),
    releaseObject: vi.fn(),
    setFrameRefinement: vi.fn(),
    setFrameTransform: vi.fn(),
    setObjectTransform: vi.fn(),
    setObjectVisibility: vi.fn(),
    setRenderQuality: vi.fn(),
  };
  return value;
}

class FakeAudio implements GaussianStreamingMediaElement {
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = 10;
  ended = false;
  muted = false;
  paused = true;
  preload = "";
  playError: Error | undefined;
  src = "audio/track.ogg";
  volume = 1;
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  pause(): void {
    this.paused = true;
  }

  async play(): Promise<void> {
    if (this.playError !== undefined) {
      throw this.playError;
    }
    this.paused = false;
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

describe("GaussianStreamingPlayer", () => {
  it("loads a complete manifest and exposes high-level playback controls", async () => {
    const adapter = renderer();
    const player = await GaussianStreamingPlayer.create({
      manifest: manifest(),
      renderer: adapter,
    });

    expect(adapter.initialise).toHaveBeenCalledOnce();
    expect(adapter.loadStaticObject).toHaveBeenCalledOnce();
    expect(adapter.loadMesh).toHaveBeenCalledOnce();
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 0,
      lifecycle: "READY",
      manifestId: "preview",
      sequenceId: "actor-0",
    });

    player.setQualityMode({ detailLevel: 0.5, mode: "manual" });
    await player.seek(2 / 30);
    expect(player.snapshot.currentFrameIndex).toBe(2);
    await player.stepFrames(-1);
    expect(player.snapshot.currentFrameIndex).toBe(1);

    player.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it("requires a sequence id when a manifest contains multiple sequences", async () => {
    const adapter = renderer();
    await expect(
      GaussianStreamingPlayer.create({ manifest: manifest(2), renderer: adapter }),
    ).rejects.toThrow("sequenceId is required");

    const selectedAdapter = renderer();
    const player = await GaussianStreamingPlayer.create({
      manifest: manifest(2),
      renderer: selectedAdapter,
      sequenceId: "actor-1",
    });
    expect(player.sequence.id).toBe("actor-1");
    player.dispose();
  });

  it("synchronises basic media controls and clears the element on dispose", async () => {
    const audio = new FakeAudio();
    const player = await GaussianStreamingPlayer.create({
      audioElementFactory: () => audio,
      manifest: manifest(1, true),
      renderer: renderer(),
    });

    player.setMuted(true);
    player.setVolume(0.4);
    await player.seek(2 / 30);
    expect(audio.currentTime).toBeCloseTo(2 / 30);
    expect(player.snapshot.audio).toEqual({
      configured: true,
      muted: true,
      volume: 0.4,
    });

    await player.play();
    player.pause();
    expect(audio.paused).toBe(true);
    player.dispose();
    expect(audio.src).toBe("");
  });

  it("anchors a paused audio clock before scheduling the first frame", async () => {
    const audio = new FakeAudio();
    const setTimeout = vi.fn(() => 1);
    const clock: PlaybackClock = {
      clearTimeout: vi.fn(),
      now: () => 120_000,
      setTimeout,
    };
    const player = await GaussianStreamingPlayer.create({
      audioElementFactory: () => audio,
      clock,
      manifest: manifest(1, true),
      renderer: renderer(),
    });

    await player.play();
    await vi.waitFor(() => expect(setTimeout).toHaveBeenCalledOnce());

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000 / 30);
    player.dispose();
  });

  it("applies audio offsets without moving media time zero", async () => {
    const audio = new FakeAudio();
    const source = manifest(1, true);
    source.audio = { offsetSeconds: 0.05, url: "audio/track.ogg" };
    const player = await GaussianStreamingPlayer.create({
      audioElementFactory: () => audio,
      manifest: source,
      renderer: renderer(),
    });

    await player.seek(0.08);
    expect(audio.currentTime).toBeCloseTo(0.03);
    player.dispose();
  });

  it("surfaces autoplay rejection even before a delayed audio region", async () => {
    const audio = new FakeAudio();
    audio.playError = new Error("gesture required");
    const source = manifest(1, true);
    source.audio = { offsetSeconds: 5, url: "audio/track.ogg" };
    const player = await GaussianStreamingPlayer.create({
      audioElementFactory: () => audio,
      manifest: source,
      renderer: renderer(),
    });

    await expect(player.play()).rejects.toThrow("gesture required");
    expect(player.snapshot.isPlaying).toBe(false);
    player.dispose();
  });

  it("reports missing audio and disposes a renderer after creation failure", async () => {
    const adapter = renderer();
    vi.mocked(adapter.loadStaticObject).mockRejectedValueOnce(
      new Error("static scene failed"),
    );

    await expect(
      GaussianStreamingPlayer.create({ manifest: manifest(), renderer: adapter }),
    ).rejects.toThrow("static scene failed");
    expect(adapter.dispose).toHaveBeenCalledOnce();

    const player = await GaussianStreamingPlayer.create({
      manifest: manifest(),
      renderer: renderer(),
    });
    expect(player.snapshot.audio.configured).toBe(false);
    player.dispose();
  });
});
