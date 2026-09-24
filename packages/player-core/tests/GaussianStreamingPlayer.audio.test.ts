import { afterEach, describe, expect, it, vi } from "vitest";

import { GaussianStreamingPlayer } from "../src/index.js";

import type {
  GaussianRendererAdapter,
  GaussianSequenceManifest,
  GaussianStreamingMediaElement,
  PlaybackClock,
  PreparedFrame,
} from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushPromises(): Promise<void> {
  for (let iteration = 0; iteration < 40; iteration += 1) {
    await Promise.resolve();
  }
}

/** Media advances with elapsed wall time, including time between scheduler callbacks. */
class AdvancingAudio implements GaussianStreamingMediaElement {
  crossOrigin: string | null = null;
  duration = 10;
  ended = false;
  frozen = false;
  muted = false;
  paused = true;
  preload = "";
  src = "audio/track.ogg";
  volume = 1;
  private currentTimeValue = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  readonly play = vi.fn(async () => {
    this.paused = false;
  });
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });

  get currentTime(): number {
    return this.currentTimeValue;
  }

  set currentTime(value: number) {
    this.currentTimeValue = Math.max(0, Math.min(value, this.duration));
    this.ended = this.currentTimeValue >= this.duration;
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0,
    );
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  pause(): void {
    this.paused = true;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  advance(milliseconds: number): void {
    if (this.paused || this.ended || this.frozen) {
      return;
    }
    this.currentTimeValue += milliseconds / 1000;
    if (this.currentTimeValue >= this.duration - 1e-9) {
      this.currentTimeValue = this.duration;
      this.ended = true;
      this.paused = true;
      this.emit("ended");
    }
  }
}

class MediaTestClock implements PlaybackClock {
  private nowValue = 0;
  private nextHandle = 0;
  private readonly timers = new Map<
    number,
    { callback: () => void; deadlineMs: number }
  >();

  constructor(private readonly audio: AdvancingAudio) {}

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = ++this.nextHandle;
    this.timers.set(handle, {
      callback,
      // Browsers do not run a recursive zero-delay timer synchronously forever.
      deadlineMs: this.nowValue + Math.max(1, delayMs),
    });
    return handle;
  }

  get timerCount(): number {
    return this.timers.size;
  }

  async advanceTo(targetMs: number): Promise<void> {
    // Native promise continuations drain before the next browser timer task.
    await flushPromises();
    let callbacks = 0;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.deadlineMs <= targetMs)
        .sort((a, b) => a[1].deadlineMs - b[1].deadlineMs)[0];
      if (next === undefined) {
        break;
      }
      if (++callbacks > 2_000) {
        throw new Error("Playback scheduled too many callbacks without progressing.");
      }
      const [handle, timer] = next;
      this.timers.delete(handle);
      this.moveTo(timer.deadlineMs);
      timer.callback();
      await flushPromises();
    }
    this.moveTo(targetMs);
    await flushPromises();
  }

  private moveTo(timeMs: number): void {
    const elapsedMs = timeMs - this.nowValue;
    this.nowValue = timeMs;
    this.audio.advance(elapsedMs);
  }
}

function createManifest(
  frameRate: number,
  frameCount: number,
  offsetSeconds = 0,
): GaussianSequenceManifest {
  return {
    audio: { offsetSeconds, url: "audio/track.ogg" },
    durationSeconds: frameCount / frameRate,
    dynamicSequences: [
      {
        frameCount,
        frameRate,
        frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
          frameIndex,
          timestampSeconds: frameIndex / frameRate,
          url: `frames/${frameIndex}.sog`,
        })),
        id: "actor",
      },
    ],
    frameCount,
    frameRate,
    id: "audio-regression",
    staticObjects: [],
    version: "1.0",
  };
}

function createRenderer(
  clock: MediaTestClock,
  blocked = new Map<number, Promise<void>>(),
) {
  const prepared = new Set<PreparedFrame>();
  const presentations: { frameIndex: number; atMs: number }[] = [];
  let maximumPreparedFrames = 0;
  const presentable = {
    detailLevel: 1,
    selectedSplatCount: 1_000,
    state: "presentable" as const,
  };
  const renderer: GaussianRendererAdapter = {
    dispose: vi.fn(),
    getFramePresentationQuality: () => presentable,
    getMetrics: () => ({
      failedResourceLoadCount: 0,
      loadedMeshObjectCount: 0,
      loadedStaticObjectCount: 0,
      loadingResourceCount: 0,
      preparedFrameCount: prepared.size,
      resources: [],
    }),
    hideFrame: vi.fn(),
    initialise: vi.fn(async () => undefined),
    loadMesh: vi.fn(async (object) => ({ id: object.id, kind: "mesh" as const })),
    loadStaticObject: vi.fn(async (object) => ({
      id: object.id,
      kind: "static-splat" as const,
    })),
    prepareFrame: vi.fn(async (sequenceId, source) => {
      await blocked.get(source.frameIndex);
      const frame: PreparedFrame = {
        frameIndex: source.frameIndex,
        qualityLevel: 1,
        rendererResource: {},
        sequenceId,
        source,
      };
      prepared.add(frame);
      maximumPreparedFrames = Math.max(maximumPreparedFrames, prepared.size);
      return frame;
    }),
    presentFrame: vi.fn((frame) => {
      presentations.push({ frameIndex: frame.frameIndex, atMs: clock.now() });
    }),
    refineFrame: vi.fn(async () => presentable),
    releaseFrame: vi.fn((frame) => prepared.delete(frame)),
    releaseObject: vi.fn(),
    setFrameRefinement: vi.fn(),
    setFrameTransform: vi.fn(),
    setObjectTransform: vi.fn(),
    setObjectVisibility: vi.fn(),
    setRenderQuality: vi.fn(),
  };
  return {
    get maximumPreparedFrames() {
      return maximumPreparedFrames;
    },
    presentations,
    renderer,
  };
}

const players = new Set<GaussianStreamingPlayer>();
afterEach(() => {
  for (const player of players) {
    player.dispose();
  }
  players.clear();
});

async function harness(
  options: {
    audioDuration?: number;
    blocked?: Map<number, Promise<void>>;
    frameCount?: number;
    frameRate?: number;
    loop?: boolean;
    offsetSeconds?: number;
    timestamps?: readonly number[];
  } = {},
) {
  const frameRate = options.frameRate ?? 30;
  const frameCount = options.frameCount ?? options.timestamps?.length ?? 30;
  const source = createManifest(frameRate, frameCount, options.offsetSeconds);
  if (options.timestamps !== undefined) {
    source.dynamicSequences[0]!.frames.forEach((frame, index) => {
      frame.timestampSeconds = options.timestamps![index]!;
    });
    source.durationSeconds = options.timestamps.at(-1)! + 1 / frameRate;
  }
  const audio = new AdvancingAudio();
  audio.duration = options.audioDuration ?? source.durationSeconds;
  const clock = new MediaTestClock(audio);
  const rendererHarness = createRenderer(clock, options.blocked);
  const player = await GaussianStreamingPlayer.create({
    audioElementFactory: () => audio,
    buffer: { futureFrameCount: 3, minimumReadyFrames: 1, previousFrameCount: 1 },
    clock,
    loop: options.loop ?? false,
    manifest: source,
    renderer: rendererHarness.renderer,
  });
  players.add(player);
  await flushPromises();
  return {
    audio,
    clock,
    player,
    presentations: rendererHarness.presentations,
    renderer: rendererHarness.renderer,
    get maximumPreparedFrames() {
      return rendererHarness.maximumPreparedFrames;
    },
  };
}

describe("GaussianStreamingPlayer audio integration", () => {
  it("preserves leading audio before a nonzero first timestamp, including loops", async () => {
    const { audio, clock, player, presentations } = await harness({
      frameRate: 10,
      loop: true,
      timestamps: [0.2, 0.4],
    });

    expect(player.snapshot.currentTimeSeconds).toBe(0);
    expect(audio.currentTime).toBe(0);
    await player.play();
    await clock.advanceTo(201);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBeCloseTo(0.201);
    expect(presentations).toEqual([{ atMs: 0, frameIndex: 0 }]);

    await clock.advanceTo(501);
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([0, 1, 0]);
    expect(presentations.at(-1)?.atMs).toBeCloseTo(500);
    expect(player.snapshot.currentFrameIndex).toBe(0);
    expect(audio.currentTime).toBeCloseTo(0.001);
    expect(audio.paused).toBe(false);
  });

  it("keeps audio aligned when seeking or stepping back into the leading interval", async () => {
    const { audio, player } = await harness({ timestamps: [0.2, 0.4] });

    await player.seek(0.4);
    await player.seek(0.1);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 0,
      currentTimeSeconds: 0.1,
      lifecycle: "PAUSED",
    });
    expect(audio.currentTime).toBeCloseTo(0.1);

    await player.seek(0);
    expect(player.snapshot.currentTimeSeconds).toBe(0);
    expect(audio.currentTime).toBe(0);

    await player.stepFrames(1);
    expect(audio.currentTime).toBeCloseTo(0.4);
    await player.stepFrames(-1);
    expect(player.snapshot.currentTimeSeconds).toBe(0);
    expect(audio.currentTime).toBe(0);
  });

  it.each([25, 30])(
    "keeps %i fps presentation cadence across successive audio loops",
    async (frameRate) => {
      const { audio, clock, player, presentations } = await harness({
        frameCount: 8,
        frameRate,
        loop: true,
      });
      await player.play();
      await flushPromises();

      await clock.advanceTo((25 * 1000) / frameRate + 2);

      expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual(
        Array.from({ length: 26 }, (_, ordinal) => ordinal % 8),
      );
      for (const [ordinal, presentation] of presentations.entries()) {
        expect(presentation.atMs).toBeCloseTo((ordinal * 1000) / frameRate, 0);
      }
      expect(player.snapshot).toMatchObject({
        currentFrameIndex: 1,
        droppedFrameCount: 0,
        isPlaying: true,
        lifecycle: "PLAYING",
      });
      expect(audio.currentTime).toBeCloseTo(1 / frameRate, 2);
    },
  );

  it.each(["pause", "seek", "step", "dispose"] as const)(
    "does not restart or rewind after %s cancels a deferred audio prime",
    async (action) => {
      const { audio, clock, player, presentations } = await harness();
      const pendingPrime = deferred();
      audio.play.mockImplementationOnce(async () => {
        await pendingPrime.promise;
        audio.paused = false;
      });
      const pendingPlay = player.play();
      await flushPromises();

      if (action === "seek") {
        await player.seek(0.5);
      } else if (action === "step") {
        await player.stepFrames(4);
      } else if (action === "dispose") {
        player.dispose();
      } else {
        player.pause();
      }
      const presentationCount = presentations.length;
      pendingPrime.resolve();
      await pendingPlay;
      await clock.advanceTo(200);

      expect(audio.paused).toBe(true);
      expect(clock.timerCount).toBe(0);
      expect(presentations).toHaveLength(presentationCount);
      expect(player.snapshot.isPlaying).toBe(false);
      if (action === "seek" || action === "step") {
        const expectedTime = action === "seek" ? 0.5 : 4 / 30;
        expect(player.snapshot.currentTimeSeconds).toBeCloseTo(expectedTime);
        expect(audio.currentTime).toBeCloseTo(expectedTime);
      }
      if (action === "dispose") {
        expect(audio.src).toBe("");
      }
    },
  );

  it("surfaces prime rejection and allows a fresh play attempt", async () => {
    const { audio, clock, player } = await harness();
    const error = new Error("gesture required");
    audio.play.mockRejectedValueOnce(error);

    await expect(player.play()).rejects.toThrow("gesture required");

    expect(player.snapshot).toMatchObject({
      error,
      isPlaying: false,
      lifecycle: "ERROR",
    });
    expect(audio.paused).toBe(true);

    await player.play();
    await clock.advanceTo(70);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 2,
      isPlaying: true,
      lifecycle: "PLAYING",
    });
    expect(player.snapshot.error).toBeUndefined();
    expect(audio.paused).toBe(false);
  });

  it("coalesces repeated play requests while priming and while playing", async () => {
    const { audio, clock, player } = await harness();
    const pendingPrime = deferred();
    audio.play.mockImplementationOnce(async () => {
      await pendingPrime.promise;
      audio.paused = false;
    });
    const firstPlay = player.play();
    const secondPlay = player.play();
    await flushPromises();
    expect(audio.play).toHaveBeenCalledOnce();

    pendingPrime.resolve();
    await Promise.all([firstPlay, secondPlay]);
    await flushPromises();
    expect(audio.play).toHaveBeenCalledTimes(2);
    await player.play();
    await clock.advanceTo(101);

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 3,
      droppedFrameCount: 0,
      isPlaying: true,
    });
  });

  it("surfaces an audio resume rejection after successful priming", async () => {
    const { audio, clock, player, presentations } = await harness();
    const error = new Error("audio resume failed");
    audio.play.mockImplementationOnce(async () => {
      audio.paused = false;
    });
    audio.play.mockRejectedValueOnce(error);

    await player.play();
    await flushPromises();
    await clock.advanceTo(200);

    expect(player.snapshot).toMatchObject({
      error,
      isPlaying: false,
      lifecycle: "ERROR",
    });
    expect(audio.paused).toBe(true);
    expect(presentations).toHaveLength(1);
    expect(clock.timerCount).toBe(0);
  });

  it("stops audio and video and reports a media error event", async () => {
    const { audio, clock, player, presentations } = await harness();
    await player.play();
    await flushPromises();
    await clock.advanceTo(70);
    const presentationCount = presentations.length;

    audio.emit("error");
    await flushPromises();
    await clock.advanceTo(270);

    expect(player.snapshot).toMatchObject({ isPlaying: false, lifecycle: "ERROR" });
    expect(player.snapshot.error).toBeDefined();
    expect(audio.paused).toBe(true);
    expect(presentations).toHaveLength(presentationCount);
    expect(clock.timerCount).toBe(0);
  });

  it("ignores a stale audio resume rejection after a newer play succeeds", async () => {
    const { audio, clock, player } = await harness();
    const oldResume = deferred();
    audio.play.mockImplementationOnce(async () => {
      audio.paused = false;
    });
    audio.play.mockImplementationOnce(() => oldResume.promise);
    await player.play();
    await flushPromises();
    player.pause();
    await player.play();
    await flushPromises();

    oldResume.reject(new Error("obsolete resume failure"));
    await clock.advanceTo(101);

    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 3,
      isPlaying: true,
      lifecycle: "PLAYING",
    });
    expect(player.snapshot.error).toBeUndefined();
    expect(audio.paused).toBe(false);
  });

  it("keeps a newer prime silent when an obsolete resume completes", async () => {
    const { audio, clock, player, presentations } = await harness();
    const oldResume = deferred();
    const newPrime = deferred();
    audio.play.mockImplementationOnce(async () => {
      audio.paused = false;
    });
    audio.play.mockImplementationOnce(async () => {
      await oldResume.promise;
      audio.paused = false;
    });
    await player.play();
    await flushPromises();
    player.pause();
    audio.play.mockImplementationOnce(async () => {
      await newPrime.promise;
      audio.paused = false;
    });
    const pendingPlay = player.play();
    await flushPromises();
    player.setMuted(true);
    player.setMuted(false);
    player.setVolume(0.25);

    oldResume.resolve();
    await clock.advanceTo(100);

    expect(audio.paused).toBe(false);
    expect(audio.muted).toBe(true);
    expect(player.snapshot).toMatchObject({
      audio: { muted: false, volume: 0.25 },
      currentFrameIndex: 0,
      isPlaying: true,
      lifecycle: "BUFFERING",
    });
    expect(presentations).toHaveLength(1);

    newPrime.resolve();
    await pendingPlay;
    await clock.advanceTo(201);

    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.25);
    expect(audio.paused).toBe(false);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 3,
      isPlaying: true,
      lifecycle: "PLAYING",
    });
    expect(player.snapshot.error).toBeUndefined();
  });

  it("preserves a mute and volume preference changed during priming", async () => {
    const { audio, clock, player } = await harness();
    const pendingPrime = deferred();
    audio.play.mockImplementationOnce(async () => {
      await pendingPrime.promise;
      audio.paused = false;
    });
    const pendingPlay = player.play();
    await flushPromises();
    expect(audio.muted).toBe(true);
    expect(player.snapshot.audio.muted).toBe(false);
    player.setMuted(true);
    player.setVolume(0.4);
    pendingPrime.resolve();
    await pendingPlay;
    await clock.advanceTo(70);

    expect(audio.muted).toBe(true);
    expect(audio.volume).toBe(0.4);
    expect(player.snapshot).toMatchObject({
      audio: { muted: true, volume: 0.4 },
      currentFrameIndex: 2,
      lifecycle: "PLAYING",
    });
  });

  it("waits for a pending prime when an earlier seek finishes preparing", async () => {
    const blockedSeek = deferred();
    const pendingPrime = deferred();
    const { audio, clock, player, presentations, renderer } = await harness({
      blocked: new Map([[8, blockedSeek.promise]]),
    });
    const seeking = player.seek(8 / 30);
    await flushPromises();
    expect(player.snapshot.lifecycle).toBe("SEEKING");
    audio.play.mockImplementationOnce(async () => {
      await pendingPrime.promise;
      audio.paused = false;
    });
    const pendingPlay = player.play();
    await flushPromises();
    blockedSeek.resolve();
    await seeking;
    await clock.advanceTo(100);

    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.muted).toBe(true);
    expect(audio.paused).toBe(true);
    expect(clock.timerCount).toBe(0);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 8,
      isPlaying: true,
      lifecycle: "BUFFERING",
    });
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([0, 8]);

    pendingPrime.resolve();
    await pendingPlay;
    await clock.advanceTo(171);

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.muted).toBe(false);
    expect(audio.currentTime).toBeCloseTo(8 / 30 + 0.071);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 10,
      droppedFrameCount: 0,
      isPlaying: true,
      lifecycle: "PLAYING",
    });
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([0, 8, 9, 10]);
    player.dispose();
    expect(audio.paused).toBe(true);
    expect(audio.listenerCount).toBe(0);
    expect(clock.timerCount).toBe(0);
    expect(renderer.getMetrics().preparedFrameCount).toBe(0);
  });

  it.each(["delayed", "frozen"])(
    "disposes listeners, timers, and prepared frames while audio is %s",
    async (audioState) => {
      const { audio, clock, player, renderer, presentations } = await harness({
        offsetSeconds: audioState === "delayed" ? 0.105 : 0,
      });
      const listener = vi.fn();
      player.subscribe(listener);
      await player.play();
      await flushPromises();
      if (audioState === "frozen") {
        audio.frozen = true;
        audio.emit("waiting");
        await clock.advanceTo(100);
      }
      expect(audio.listenerCount).toBeGreaterThan(0);
      expect(clock.timerCount).toBeGreaterThan(0);
      player.dispose();
      const emissionCount = listener.mock.calls.length;
      const presentationCount = presentations.length;

      audio.emit("error");
      audio.emit("playing");
      await clock.advanceTo(300);
      player.dispose();

      expect(audio.listenerCount).toBe(0);
      expect(clock.timerCount).toBe(0);
      expect(audio.paused).toBe(true);
      expect(audio.src).toBe("");
      expect(audio.removeAttribute).toHaveBeenCalledExactlyOnceWith("src");
      expect(audio.load).toHaveBeenCalledOnce();
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(renderer.getMetrics().preparedFrameCount).toBe(0);
      expect(presentations).toHaveLength(presentationCount);
      expect(listener).toHaveBeenCalledTimes(emissionCount);
    },
  );

  it.each([false, true])(
    "holds video while media time is frozen (waiting event: %s)",
    async (emitWaiting) => {
      const { audio, clock, player, presentations } = await harness();
      await player.play();
      await flushPromises();
      await clock.advanceTo(70);
      const frameIndex = player.snapshot.currentFrameIndex;
      const presentationCount = presentations.length;
      audio.frozen = true;
      if (emitWaiting) {
        audio.emit("waiting");
      }

      await clock.advanceTo(370);

      expect(player.snapshot.currentFrameIndex).toBe(frameIndex);
      expect(presentations).toHaveLength(presentationCount);
      expect(audio.currentTime).toBeCloseTo(0.07);
      audio.frozen = false;
      audio.emit("playing");
      await clock.advanceTo(440);
      expect(player.snapshot.currentFrameIndex).toBeGreaterThan(frameIndex);
      expect(player.snapshot.droppedFrameCount).toBe(0);
    },
  );

  it("pauses audio during frame buffering and resumes both on the same timeline", async () => {
    const blockedFrame = deferred();
    const { audio, clock, player } = await harness({
      blocked: new Map([[2, blockedFrame.promise]]),
    });
    await player.play();
    await flushPromises();
    await clock.advanceTo(70);
    expect(player.snapshot.lifecycle).toBe("BUFFERING");
    expect(audio.paused).toBe(true);
    const pausedMediaTime = audio.currentTime;

    await clock.advanceTo(270);
    expect(audio.currentTime).toBe(pausedMediaTime);
    blockedFrame.resolve();
    await flushPromises();
    expect(player.snapshot.lifecycle).toBe("PLAYING");
    expect(audio.paused).toBe(false);

    await clock.advanceTo(305);
    expect(player.snapshot).toMatchObject({
      currentFrameIndex: 3,
      droppedFrameCount: 0,
    });
    expect(audio.currentTime).toBeCloseTo(player.snapshot.currentTimeSeconds, 2);
  });

  it("continues video after a shorter audio track ends", async () => {
    const { audio, clock, player, presentations } = await harness({
      audioDuration: 0.08,
      frameCount: 8,
      frameRate: 25,
    });
    await player.play();
    await flushPromises();
    await clock.advanceTo(321);

    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(player.snapshot).toMatchObject({ isPlaying: false, lifecycle: "ENDED" });
    expect(player.snapshot.currentTimeSeconds).toBeCloseTo(0.32);
    expect(audio.currentTime).toBe(0.08);
    expect(audio.paused).toBe(true);
  });

  it.each([25, 30])(
    "loops %i fps video with audio longer than the sequence",
    async (frameRate) => {
      const { audio, clock, player, presentations } = await harness({
        audioDuration: 2,
        frameCount: 8,
        frameRate,
        loop: true,
      });
      await player.play();
      await clock.advanceTo((25 * 1000) / frameRate + 2);

      expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual(
        Array.from({ length: 26 }, (_, ordinal) => ordinal % 8),
      );
      for (const [ordinal, presentation] of presentations.entries()) {
        expect(presentation.atMs).toBeCloseTo((ordinal * 1000) / frameRate, 0);
      }
      expect(audio.ended).toBe(false);
      expect(audio.paused).toBe(false);
      expect(audio.currentTime).toBeCloseTo(1 / frameRate, 2);
      expect(player.snapshot).toMatchObject({
        currentFrameIndex: 1,
        droppedFrameCount: 0,
        isPlaying: true,
        lifecycle: "PLAYING",
      });
    },
  );

  it("starts delayed audio at its offset without shifting video deadlines", async () => {
    const { audio, clock, player, presentations } = await harness({
      frameRate: 25,
      offsetSeconds: 0.12,
    });
    await player.play();
    await flushPromises();
    await clock.advanceTo(119);
    expect(audio.currentTime).toBe(0);
    expect(audio.paused).toBe(true);

    await clock.advanceTo(201);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBeCloseTo(0.081);
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(presentations.at(-1)?.atMs).toBeCloseTo(200);
  });

  it("starts a negative-offset audio track at the matching media position", async () => {
    const { audio, clock, player } = await harness({
      frameRate: 25,
      offsetSeconds: -0.08,
    });
    await player.play();
    await flushPromises();
    expect(audio.currentTime).toBeCloseTo(0.08);

    await clock.advanceTo(81);
    expect(player.snapshot.currentFrameIndex).toBe(2);
    expect(audio.currentTime).toBeCloseTo(0.161);
  });

  it("starts audio between video deadlines without delaying the next frame", async () => {
    const { audio, clock, player, presentations } = await harness({
      frameRate: 25,
      offsetSeconds: 0.105,
    });
    await player.play();
    await clock.advanceTo(104);
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
    await clock.advanceTo(106);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBeCloseTo(0.001);
    await clock.advanceTo(201);
    expect(audio.currentTime).toBeCloseTo(0.096);
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(presentations.at(-1)?.atMs).toBeCloseTo(200);
  });

  it("starts delayed audio within a long irregular video frame interval", async () => {
    const { audio, clock, player, presentations } = await harness({
      offsetSeconds: 0.5,
      timestamps: [0, 2],
    });
    await player.play();
    await clock.advanceTo(499);
    expect(audio.paused).toBe(true);
    await clock.advanceTo(501);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBeCloseTo(0.001);
    expect(presentations).toHaveLength(1);
    await clock.advanceTo(2_001);
    expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([0, 1]);
    expect(presentations.at(-1)?.atMs).toBeCloseTo(2_000);
    expect(audio.currentTime).toBeCloseTo(1.501);
  });

  it.each([25, 30])(
    "seeks near a 120-second %i fps sequence end and loops with a bounded frame ring",
    async (frameRate) => {
      const frameCount = 120 * frameRate;
      const result = await harness({ frameCount, frameRate, loop: true });
      const { audio, clock, player, presentations, renderer } = result;
      await player.seek((frameCount - 2) / frameRate);
      presentations.length = 0;
      await player.play();
      await flushPromises();

      await clock.advanceTo((6 * 1000) / frameRate + 2);

      expect(presentations.map(({ frameIndex }) => frameIndex)).toEqual([
        frameCount - 1,
        0,
        1,
        2,
        3,
        4,
      ]);
      expect(player.snapshot).toMatchObject({
        currentFrameIndex: 4,
        droppedFrameCount: 0,
      });
      expect(audio.currentTime).toBeCloseTo(4 / frameRate, 2);
      expect(renderer.getMetrics().preparedFrameCount).toBeLessThanOrEqual(5);
      expect(result.maximumPreparedFrames).toBeLessThanOrEqual(7);
      expect(vi.mocked(renderer.prepareFrame).mock.calls.length).toBeLessThan(20);
    },
  );
});
