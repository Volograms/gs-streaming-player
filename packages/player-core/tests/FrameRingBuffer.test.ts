import { describe, expect, it, vi } from "vitest";

import { FrameRingBuffer } from "../src/index.js";

import type {
  DynamicGaussianSequence,
  GaussianRendererAdapter,
  PreparedFrame,
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

function createSequence(frameCount = 6): DynamicGaussianSequence {
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

function createRendererHarness() {
  const preparations = new Map<number, Deferred<PreparedFrame>>();
  const prepareFrame = vi.fn(
    async (_sequenceId: string, source: { frameIndex: number }) => {
      const pending = deferred<PreparedFrame>();
      preparations.set(source.frameIndex, pending);
      return pending.promise;
    },
  );
  const presentFrame = vi.fn();
  const releaseFrame = vi.fn();
  const setFrameRefinement = vi.fn();
  const renderer = {
    dispose: vi.fn(),
    getMetrics: vi.fn(),
    hideFrame: vi.fn(),
    initialise: vi.fn(),
    loadMesh: vi.fn(),
    loadStaticObject: vi.fn(),
    prepareFrame,
    presentFrame,
    releaseFrame,
    releaseObject: vi.fn(),
    setFrameRefinement,
    setObjectTransform: vi.fn(),
    setObjectVisibility: vi.fn(),
    setRenderQuality: vi.fn(),
  } as unknown as GaussianRendererAdapter;

  function resolve(frameIndex: number): PreparedFrame {
    const preparedFrame: PreparedFrame = {
      frameIndex,
      qualityLevel: 0,
      rendererResource: { frameIndex },
      sequenceId: "actor",
      source: {
        frameIndex,
        timestampSeconds: frameIndex / 30,
        url: `/frame-${frameIndex}.rad`,
      },
    };
    const pending = preparations.get(frameIndex);
    if (pending === undefined) {
      throw new Error(`Frame ${frameIndex} has not been requested.`);
    }
    pending.resolve(preparedFrame);
    return preparedFrame;
  }

  return {
    preparations,
    presentFrame,
    releaseFrame,
    renderer,
    resolve,
    setFrameRefinement,
  };
}

describe("FrameRingBuffer", () => {
  it("keeps the current frame presented until the requested replacement is playable", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);

    expect([...harness.preparations.keys()]).toEqual([0, 1, 2]);
    const frame0 = harness.resolve(0);
    await initialising;
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame0);

    const switching = buffer.present(1);
    expect(harness.presentFrame).toHaveBeenCalledTimes(1);
    const frame1 = harness.resolve(1);
    await switching;
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame1);
    expect(buffer.snapshot.currentFrameIndex).toBe(1);
  });

  it("retains the presented frame during a seek outside the destination window", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      loop: true,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    const frame0 = harness.resolve(0);
    await initialising;

    const seeking = buffer.present(4);

    expect(harness.releaseFrame).not.toHaveBeenCalledWith(frame0);
    expect(buffer.snapshot.frames.map(({ frameIndex }) => frameIndex)).toEqual([0, 4]);
    expect(buffer.snapshot.frames).toHaveLength(buffer.snapshot.capacity);

    const frame4 = harness.resolve(4);
    await seeking;

    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame4);
    expect(harness.releaseFrame).toHaveBeenCalledWith(frame0);
  });

  it("bounds ownership, refines future frames, and evicts frames behind the window", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await initialising;
    const frame1 = harness.resolve(1);

    expect(harness.setFrameRefinement).not.toHaveBeenCalledWith(frame1, true);

    const frame2 = harness.resolve(2);
    await buffer.whenBuffered();

    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame1, true);
    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame2, true);

    const movingToOne = buffer.present(1);
    await movingToOne;
    const frame3 = harness.resolve(3);
    await buffer.whenBuffered();
    const movingToTwo = buffer.present(2);
    await movingToTwo;
    harness.resolve(4);
    await buffer.whenBuffered();

    expect(buffer.snapshot.frames.map(({ frameIndex }) => frameIndex)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(harness.releaseFrame).toHaveBeenCalledWith(
      expect.objectContaining({ frameIndex: 0 }),
    );
    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame3, true);
  });

  it("prioritises every base frame before starting future refinement", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(1);
    harness.resolve(1);
    await initialising;
    const frame2 = harness.resolve(2);
    const frame3 = harness.resolve(3);

    expect(harness.setFrameRefinement).not.toHaveBeenCalledWith(frame2, true);
    expect(harness.setFrameRefinement).not.toHaveBeenCalledWith(frame3, true);

    harness.resolve(0);
    await buffer.whenBuffered();

    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame2, true);
    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame3, true);
  });

  it("cancels in-flight frames and releases prepared frames on disposal", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    const frame0 = harness.resolve(0);
    await initialising;

    buffer.dispose();

    expect(harness.releaseFrame).toHaveBeenCalledWith(frame0);
    expect(buffer.snapshot.frames).toEqual([]);
  });
});
