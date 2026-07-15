import { describe, expect, it, vi } from "vitest";

import { FrameRingBuffer } from "../src/index.js";

import type {
  DynamicGaussianSequence,
  FramePresentationQuality,
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

function createRendererHarness({ automaticQuality = true } = {}) {
  const preparations = new Map<number, Deferred<PreparedFrame>>();
  const presentationQualities = new Map<number, FramePresentationQuality>();
  const qualityPreparations = new Map<number, Deferred<FramePresentationQuality>>();
  const prepareFrame = vi.fn(
    async (_sequenceId: string, source: { frameIndex: number }) => {
      const pending = deferred<PreparedFrame>();
      preparations.set(source.frameIndex, pending);
      return pending.promise;
    },
  );
  const presentFrame = vi.fn();
  const refineFrame = vi.fn(
    async (frame: PreparedFrame, target: { detailLevel: number }) => {
      const quality: FramePresentationQuality = {
        detailLevel: target.detailLevel,
        selectedSplatCount: 10_000,
        state: "presentable",
      };
      if (automaticQuality) {
        presentationQualities.set(frame.frameIndex, quality);
        return quality;
      }
      const pending = deferred<FramePresentationQuality>();
      qualityPreparations.set(frame.frameIndex, pending);
      return pending.promise.then((result) => {
        presentationQualities.set(frame.frameIndex, result);
        return result;
      });
    },
  );
  const releaseFrame = vi.fn();
  const setFrameRefinement = vi.fn();
  const renderer = {
    dispose: vi.fn(),
    getFramePresentationQuality: vi.fn(
      (frame: PreparedFrame) =>
        presentationQualities.get(frame.frameIndex) ?? {
          detailLevel: 0,
          selectedSplatCount: 1,
          state: "root-ready",
        },
    ),
    getMetrics: vi.fn(),
    hideFrame: vi.fn(),
    initialise: vi.fn(),
    loadMesh: vi.fn(),
    loadStaticObject: vi.fn(),
    prepareFrame,
    presentFrame,
    refineFrame,
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

  function resolveQuality(frameIndex: number): void {
    const pending = qualityPreparations.get(frameIndex);
    if (pending === undefined) {
      throw new Error(`Frame ${frameIndex} refinement has not been requested.`);
    }
    pending.resolve({
      detailLevel: 0.25,
      selectedSplatCount: 10_000,
      state: "presentable",
    });
  }

  return {
    preparations,
    presentationQualities,
    presentFrame,
    qualityPreparations,
    refineFrame,
    releaseFrame,
    renderer,
    resolve,
    resolveQuality,
    setFrameRefinement,
  };
}

describe("FrameRingBuffer", () => {
  it("keeps the current frame presented until the requested replacement is playable", async () => {
    const harness = createRendererHarness({ automaticQuality: false });
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);

    expect([...harness.preparations.keys()]).toEqual([0, 1, 2]);
    const frame0 = harness.resolve(0);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(0)).toBe(true));
    harness.resolveQuality(0);
    await initialising;
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame0);

    const switching = buffer.present(1);
    expect(harness.presentFrame).toHaveBeenCalledTimes(1);
    harness.resolve(1);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(1)).toBe(true));
    expect(harness.presentFrame).toHaveBeenCalledTimes(1);
    harness.resolveQuality(1);
    await switching;
    expect(harness.presentFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ frameIndex: 1 }),
    );
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

    expect(harness.refineFrame).not.toHaveBeenCalledWith(
      frame1,
      expect.anything(),
      expect.anything(),
    );

    const frame2 = harness.resolve(2);
    await buffer.whenBuffered();

    await vi.waitFor(() => {
      expect(harness.refineFrame).toHaveBeenCalledWith(
        frame1,
        expect.objectContaining({ detailLevel: 0.25 }),
        expect.anything(),
      );
      expect(harness.refineFrame).toHaveBeenCalledWith(
        frame2,
        expect.objectContaining({ detailLevel: 0.25 }),
        expect.anything(),
      );
    });

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
    expect(harness.refineFrame).toHaveBeenCalledWith(
      frame3,
      expect.objectContaining({ detailLevel: 0.25 }),
      expect.anything(),
    );
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

    expect(harness.refineFrame).not.toHaveBeenCalledWith(
      frame2,
      expect.anything(),
      expect.anything(),
    );
    expect(harness.refineFrame).not.toHaveBeenCalledWith(
      frame3,
      expect.anything(),
      expect.anything(),
    );

    harness.resolve(0);
    await buffer.whenBuffered();

    await vi.waitFor(() => {
      expect(harness.refineFrame).toHaveBeenCalledWith(
        frame2,
        expect.anything(),
        expect.anything(),
      );
      expect(harness.refineFrame).toHaveBeenCalledWith(
        frame3,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it("revalidates a formerly ready frame before handing it to the renderer", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await initialising;
    const frame1 = harness.resolve(1);
    await vi.waitFor(() => expect(buffer.isPresentationReady(1)).toBe(true));
    const initialRefinementCount = harness.refineFrame.mock.calls.filter(
      ([frame]) => frame === frame1,
    ).length;

    harness.presentationQualities.set(1, {
      detailLevel: 0.25,
      selectedSplatCount: 1,
      state: "refining",
    });
    expect(buffer.isPresentationReady(1)).toBe(false);

    await buffer.present(1);

    expect(
      harness.refineFrame.mock.calls.filter(([frame]) => frame === frame1).length,
    ).toBeGreaterThan(initialRefinementCount);
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame1);
  });

  it("prevents a slower superseded presentation from replacing a newer request", async () => {
    const harness = createRendererHarness({ automaticQuality: false });
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(0)).toBe(true));
    harness.resolveQuality(0);
    await initialising;

    const firstPresentation = buffer.present(1);
    harness.resolve(1);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(1)).toBe(true));

    const secondPresentation = buffer.present(2);
    const frame2 = harness.resolve(2);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(2)).toBe(true));
    harness.resolveQuality(2);
    await secondPresentation;

    harness.resolveQuality(1);
    await expect(firstPresentation).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame2);
    expect(buffer.snapshot.currentFrameIndex).toBe(2);
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
