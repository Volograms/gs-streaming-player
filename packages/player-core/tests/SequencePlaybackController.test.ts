import { describe, expect, it, vi } from "vitest";

import { SequencePlaybackController } from "../src/index.js";

import type {
  DynamicGaussianSequence,
  FramePresentationOptions,
  FrameRingBufferSnapshot,
  PlaybackClock,
  PreparedFrame,
  SequencePlaybackBuffer,
} from "../src/index.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await Promise.resolve();
  }
}

class FakePlaybackClock implements PlaybackClock {
  private nextHandle = 1;
  private nowValue = 0;
  private readonly timers = new Map<
    number,
    { callback: () => void; deadlineMs: number }
  >();

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, {
      callback,
      deadlineMs: this.nowValue + delayMs,
    });
    return handle;
  }

  async advanceTo(targetMs: number): Promise<void> {
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.deadlineMs <= targetMs)
        .sort((a, b) => a[1].deadlineMs - b[1].deadlineMs)[0];
      if (next === undefined) {
        break;
      }
      const [handle, timer] = next;
      this.timers.delete(handle);
      this.nowValue = timer.deadlineMs;
      timer.callback();
      await flushPromises();
    }
    this.nowValue = targetMs;
    await flushPromises();
  }
}

function createSequence(frameCount = 120): DynamicGaussianSequence {
  return {
    frameCount,
    frameRate: 30,
    frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
      frameIndex,
      timestampSeconds: frameIndex / 30,
      url: `/frame-${frameIndex}.rad`,
    })),
    id: "actor",
  };
}

function preparedFrame(frameIndex: number): PreparedFrame {
  return {
    frameIndex,
    qualityLevel: 0.25,
    rendererResource: { frameIndex },
    sequenceId: "actor",
    source: {
      frameIndex,
      timestampSeconds: frameIndex / 30,
      url: `/frame-${frameIndex}.rad`,
    },
  };
}

function createBufferHarness(options: { allReady?: boolean } = {}) {
  let currentFrameIndex = 0;
  const ready = new Set<number>([0]);
  const pendingPreparation = new Map<number, Deferred<void>>();
  const whenReadyAhead = vi.fn<(frameCount?: number) => Promise<void>>(
    async () => undefined,
  );
  if (options.allReady === true) {
    for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
      ready.add(frameIndex);
    }
  }

  const prepareForPresentation = vi.fn(async (frameIndex: number) => {
    const pending = pendingPreparation.get(frameIndex);
    if (pending !== undefined) {
      await pending.promise;
    }
    ready.add(frameIndex);
    return preparedFrame(frameIndex);
  });
  const present = vi.fn(
    async (frameIndex: number, presentationOptions?: FramePresentationOptions) => {
      if (presentationOptions?.signal?.aborted === true) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      if (!ready.has(frameIndex)) {
        throw new Error(`Frame ${frameIndex} is not ready.`);
      }
      currentFrameIndex = frameIndex;
      return preparedFrame(frameIndex);
    },
  );
  const buffer = {
    get snapshot(): FrameRingBufferSnapshot {
      return {
        activeBasePreparationCount: 0,
        capacity: 5,
        currentFrameIndex,
        frames: [...ready].map((frameIndex) => ({
          deadlineMs: 0,
          downloadedBytes: 1,
          frameIndex,
          qualityLevel: 0.25,
          requestedBytes: 1,
          status: frameIndex === currentFrameIndex ? "presented" : "ready",
          targetQualityLevel: 0.25,
          timestampSeconds: frameIndex / 30,
        })),
        futureFrameCount: 3,
        previousFrameCount: 1,
        queuedBasePreparationCount: 0,
      };
    },
    isPresentationReady: vi.fn((frameIndex: number) => ready.has(frameIndex)),
    prepareForPresentation,
    present,
    whenPresentationReadyAhead: whenReadyAhead,
  } satisfies SequencePlaybackBuffer;

  return {
    buffer,
    pendingPreparation,
    prepareForPresentation,
    present,
    ready,
    whenReadyAhead,
  };
}

describe("SequencePlaybackController", () => {
  it("uses absolute 30 fps deadlines without accumulating timer drift", async () => {
    const clock = new FakePlaybackClock();
    const harness = createBufferHarness({ allReady: true });
    const controller = new SequencePlaybackController({
      buffer: harness.buffer,
      clock,
      loop: true,
      minimumReadyFrames: 0,
      sequence: createSequence(),
    });

    controller.play();
    await flushPromises();
    expect(controller.snapshot.lifecycle).toBe("PLAYING");

    await clock.advanceTo(1_000);

    expect(harness.present).toHaveBeenCalledTimes(30);
    expect(controller.snapshot).toMatchObject({
      currentFrameIndex: 30,
      droppedFrameCount: 0,
      lifecycle: "PLAYING",
      targetFramesPerSecond: 30,
    });
  });

  it("remains buffering until the requested startup reserve is ready", async () => {
    const clock = new FakePlaybackClock();
    const harness = createBufferHarness({ allReady: true });
    const startup = deferred<void>();
    harness.whenReadyAhead.mockImplementationOnce(async () => startup.promise);
    const controller = new SequencePlaybackController({
      buffer: harness.buffer,
      clock,
      loop: true,
      minimumReadyFrames: 2,
      sequence: createSequence(),
    });

    controller.play();
    await flushPromises();
    expect(controller.snapshot.lifecycle).toBe("BUFFERING");
    expect(harness.whenReadyAhead).toHaveBeenCalledWith(2);
    expect(harness.present).not.toHaveBeenCalled();

    startup.resolve(undefined);
    await flushPromises();
    expect(controller.snapshot.lifecycle).toBe("PLAYING");
  });

  it("holds the previous frame on a miss and presents only after refinement", async () => {
    const clock = new FakePlaybackClock();
    const harness = createBufferHarness();
    const frameOne = deferred<void>();
    harness.pendingPreparation.set(1, frameOne);
    const controller = new SequencePlaybackController({
      buffer: harness.buffer,
      clock,
      loop: true,
      minimumReadyFrames: 0,
      sequence: createSequence(),
    });
    controller.play();
    await flushPromises();

    await clock.advanceTo(1000 / 30);
    expect(controller.snapshot).toMatchObject({
      currentFrameIndex: 0,
      lifecycle: "BUFFERING",
    });
    expect(harness.present).not.toHaveBeenCalled();

    frameOne.resolve(undefined);
    await flushPromises();
    expect(harness.present).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(controller.snapshot).toMatchObject({
      currentFrameIndex: 1,
      lifecycle: "PLAYING",
    });
  });

  it("does not perform a late handoff when paused during buffering", async () => {
    const clock = new FakePlaybackClock();
    const harness = createBufferHarness();
    const frameOne = deferred<void>();
    harness.pendingPreparation.set(1, frameOne);
    const controller = new SequencePlaybackController({
      buffer: harness.buffer,
      clock,
      loop: true,
      minimumReadyFrames: 0,
      sequence: createSequence(),
    });
    controller.play();
    await flushPromises();
    await clock.advanceTo(1000 / 30);

    controller.pause();
    frameOne.resolve(undefined);
    await flushPromises();

    expect(harness.present).not.toHaveBeenCalled();
    expect(controller.snapshot).toMatchObject({
      currentFrameIndex: 0,
      isPlaying: false,
      lifecycle: "PAUSED",
    });
  });
});
