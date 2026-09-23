import { GaussianFrameDecoderRegistry } from "@6g-path/gaussian-codec";
import { describe, expect, it, vi } from "vitest";

import { FrameRingBuffer } from "../src/index.js";

import type {
  DynamicGaussianSequence,
  FramePreparationOptions,
  FramePresentationQuality,
  FrameRingBufferTraceEvent,
  FrameRefinementOptions,
  GaussianRendererAdapter,
  PreparedFrame,
} from "../src/index.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return { promise, reject, resolve };
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
    async (
      _sequenceId: string,
      source: { frameIndex: number; url: string },
      options: FramePreparationOptions,
    ) => {
      options.onTrace?.({ elapsedMs: 1, phase: "resource-created" });
      const pending = deferred<PreparedFrame>();
      preparations.set(source.frameIndex, pending);
      const handleAbort = () => {
        const error = new Error("Frame preparation was aborted.");
        error.name = "AbortError";
        pending.reject(error);
      };
      options.signal?.addEventListener("abort", handleAbort, { once: true });
      return pending.promise.finally(() => {
        options.signal?.removeEventListener("abort", handleAbort);
      });
    },
  );
  const presentFrame = vi.fn();
  const refineFrame = vi.fn(
    async (
      frame: PreparedFrame,
      target: { detailLevel: number },
      options?: FrameRefinementOptions,
    ) => {
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
      const handleAbort = () => {
        const error = new Error("Frame refinement was aborted.");
        error.name = "AbortError";
        pending.reject(error);
      };
      options?.signal?.addEventListener("abort", handleAbort, { once: true });
      return pending.promise
        .then((result) => {
          presentationQualities.set(frame.frameIndex, result);
          return result;
        })
        .finally(() => {
          options?.signal?.removeEventListener("abort", handleAbort);
        });
    },
  );
  const releaseFrame = vi.fn();
  const setFrameRefinement = vi.fn();
  const setFrameTransform = vi.fn();
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
    setFrameTransform,
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
    prepareFrame,
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
    setFrameTransform,
  };
}

describe("FrameRingBuffer", () => {
  it("assigns preparation deadlines from manifest timestamps", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(3);
    sequence.frames = [0, 0.1, 0.11].map((timestampSeconds, frameIndex) => ({
      frameIndex,
      timestampSeconds,
      url: `/frame-${frameIndex}.rad`,
    }));
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      now: () => 500,
      renderer: harness.renderer,
      sequence,
    });

    void buffer.initialise(0).catch(() => undefined);
    await vi.waitFor(() => expect(harness.prepareFrame).toHaveBeenCalledTimes(3));

    const deadlines = new Map(
      buffer.snapshot.frames.map(({ deadlineMs, frameIndex }) => [
        frameIndex,
        deadlineMs,
      ]),
    );
    expect(deadlines.get(0)).toBeCloseTo(500);
    expect(deadlines.get(1)).toBeCloseTo(600);
    expect(deadlines.get(2)).toBeCloseTo(610);
    buffer.dispose();
  });

  it("decodes codec-tagged bytes before passing neutral attributes to the renderer", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(1);
    sequence.frames[0] = {
      ...sequence.frames[0]!,
      byteSize: 4,
      codec: "spz-v4",
      url: "/frame-0.spz",
    };
    const decodedFrame: DecodedGaussianFrame = {
      alphas: new Float32Array([1]),
      antialiased: false,
      codecId: "spz-v4",
      colors: new Float32Array([1, 1, 1]),
      coordinateSystem: "RUB",
      numSplats: 1,
      positions: new Float32Array([0, 0, 0]),
      rotations: new Float32Array([0, 0, 0, 1]),
      scales: new Float32Array([1, 1, 1]),
      shDegree: 0,
      sphericalHarmonics: new Float32Array(),
    };
    const decode = vi.fn(async () => decodedFrame);
    const trace: FrameRingBufferTraceEvent[] = [];
    const buffer = new FrameRingBuffer({
      compressedBufferMaximumBytes: 16,
      compressedFrameFetch: vi.fn(async () =>
        Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]))),
      ),
      decoderRegistry: new GaussianFrameDecoderRegistry([
        { codecId: "spz-v4", decode },
      ]),
      futureFrameCount: 0,
      onTrace: (event) => trace.push(event),
      renderer: harness.renderer,
      sequence,
    });

    void buffer.initialise(0).catch(() => undefined);

    await vi.waitFor(() => expect(harness.prepareFrame).toHaveBeenCalledOnce());
    expect(decode).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ coordinateSystem: "RUB" }),
    );
    expect(harness.prepareFrame.mock.calls[0]?.[2]).toMatchObject({
      compressedBytes: expect.any(ArrayBuffer),
      decodedFrame,
    });
    expect(trace.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["codec-decode-started", "codec-decode-ready"]),
    );
    buffer.dispose();
  });

  it("lets a renderer consume supported compressed frames without neutral decoding", async () => {
    const harness = createRendererHarness();
    harness.renderer.canPrepareCompressedFrame = (codecId) => codecId === "spz-v4";
    const sequence = createSequence(1);
    sequence.frames[0] = {
      ...sequence.frames[0]!,
      byteSize: 4,
      codec: "spz-v4",
      url: "/frame-0.spz",
    };
    const decode = vi.fn();
    const buffer = new FrameRingBuffer({
      compressedBufferMaximumBytes: 16,
      compressedFrameFetch: vi.fn(async () =>
        Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]))),
      ),
      decoderRegistry: new GaussianFrameDecoderRegistry([
        { codecId: "spz-v4", decode },
      ]),
      futureFrameCount: 0,
      renderer: harness.renderer,
      sequence,
    });

    void buffer.initialise(0).catch(() => undefined);

    await vi.waitFor(() => expect(harness.prepareFrame).toHaveBeenCalledOnce());
    expect(decode).not.toHaveBeenCalled();
    expect(harness.prepareFrame.mock.calls[0]?.[2]).toMatchObject({
      compressedBytes: expect.any(ArrayBuffer),
    });
    expect(harness.prepareFrame.mock.calls[0]?.[2].decodedFrame).toBeUndefined();
    buffer.dispose();
  });

  it("prefetches compressed bytes beyond the decoded frame window", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(8);
    sequence.frames = sequence.frames.map((source) => ({
      ...source,
      qualityLevels: [
        {
          byteSize: 4,
          detailLevel: 0.25,
          level: 0,
          minimumPlayable: true,
          url: `/frame-${source.frameIndex}.spz`,
        },
      ],
    }));
    const compressedFrameFetch = vi.fn(async () =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]))),
    );
    const buffer = new FrameRingBuffer({
      compressedBufferMaximumBytes: 32,
      compressedFrameFetch,
      futureFrameCount: 3,
      loop: true,
      maximumBasePreparationConcurrency: 2,
      previousFrameCount: 1,
      renderer: harness.renderer,
      sequence,
    });

    void buffer.initialise(0).catch(() => undefined);

    await vi.waitFor(() => expect(compressedFrameFetch).toHaveBeenCalledTimes(8));
    await vi.waitFor(() => expect(harness.prepareFrame).toHaveBeenCalled());
    expect(buffer.snapshot.capacity).toBe(5);
    expect(buffer.snapshot.compressedBuffer).toMatchObject({
      capacityBytes: 32,
      readyFrameCount: 8,
      residentBytes: 32,
    });
    expect(harness.prepareFrame.mock.calls[0]?.[2]).toMatchObject({
      compressedBytes: expect.any(ArrayBuffer),
    });
    buffer.dispose();
  });

  it.each([25, 30])(
    "bounds prefetch visits for a two-minute %s fps clip through seeks, loops, and tier changes",
    async (fps) => {
      const harness = createRendererHarness();
      const sequence = createSequence(fps * 120);
      sequence.frameRate = fps;
      const visited = new Set<number>();
      sequence.frames = sequence.frames.map((frame) => ({
        ...frame,
        timestampSeconds: frame.frameIndex / fps,
        get qualityLevels() {
          visited.add(frame.frameIndex);
          return [0.25, 1].map((detailLevel, level) => ({
            byteSize: level === 0 ? 4 : 8,
            detailLevel,
            level,
            minimumPlayable: level === 0,
            url: `/frame-${frame.frameIndex}-${level}.sog`,
          }));
        },
      }));
      const compressedFrameFetch = vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(new Uint8Array(String(input).endsWith("-0.sog") ? 4 : 8)),
      );
      const buffer = new FrameRingBuffer({
        compressedBufferMaximumBytes: 20,
        compressedFrameFetch,
        futureFrameCount: 1,
        previousFrameCount: 0,
        loop: true,
        renderer: harness.renderer,
        sequence,
      });
      try {
        const initialising = buffer.initialise(0);
        await vi.waitFor(() => expect(harness.preparations.has(0)).toBe(true));
        harness.resolve(0);
        await initialising;
        expect([...visited].sort((left, right) => left - right)).toEqual([
          0, 1, 2, 3, 4,
        ]);

        visited.clear();
        const last = sequence.frameCount - 1;
        const seeking = buffer.present(last);
        await vi.waitFor(() => expect(harness.preparations.has(last)).toBe(true));
        harness.resolve(last);
        await seeking;
        expect([...visited].every((index) => index === last || index < 5)).toBe(true);
        expect(visited.size).toBeLessThanOrEqual(6);
        await vi.waitFor(() => expect(harness.preparations.has(0)).toBe(true));
        harness.resolve(0);
        await buffer.whenPresentationReadyAhead(1);
        await buffer.present(0);

        visited.clear();
        buffer.setPresentationQualityTarget({ detailLevel: 1, minimumSplatCount: 2 });
        await vi.waitFor(() =>
          expect(compressedFrameFetch).toHaveBeenCalledWith(
            "/frame-1-1.sog",
            expect.anything(),
          ),
        );
        expect(visited.size).toBeLessThanOrEqual(5);
        expect([...visited].every((index) => index < 5)).toBe(true);
      } finally {
        buffer.dispose();
      }
    },
  );

  it("does not scan a native progressive sequence for compressed prefetch", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(3_600);
    const visited = new Set<number>();
    sequence.frames = sequence.frames.map((frame) => ({
      ...frame,
      get qualityLevels() {
        visited.add(frame.frameIndex);
        return [];
      },
    }));
    const compressedFrameFetch = vi.fn();
    const buffer = new FrameRingBuffer({
      compressedBufferMaximumBytes: 20,
      compressedFrameFetch,
      futureFrameCount: 1,
      renderer: harness.renderer,
      sequence,
    });
    try {
      const initialising = buffer.initialise(0);
      harness.resolve(0);
      await initialising;
      expect([...visited].sort()).toEqual([0, 1]);
      expect(compressedFrameFetch).not.toHaveBeenCalled();
    } finally {
      buffer.dispose();
    }
  });

  it("still fetches demanded compressed frames beyond a native progressive boundary", async () => {
    const harness = createRendererHarness();
    harness.renderer.canPrepareCompressedFrame = () => true;
    const sequence = createSequence(3);
    sequence.frames[1] = {
      ...sequence.frames[1]!,
      codec: "sog",
      byteSize: 4,
      url: "/frame-1.sog",
    };
    const compressedFrameFetch = vi.fn(async () => new Response(new Uint8Array(4)));
    const buffer = new FrameRingBuffer({
      compressedBufferMaximumBytes: 20,
      compressedFrameFetch,
      futureFrameCount: 1,
      renderer: harness.renderer,
      sequence,
    });
    try {
      const initialising = buffer.initialise(0);
      harness.resolve(0);
      await initialising;
      await vi.waitFor(() => expect(harness.preparations.has(1)).toBe(true));
      const frame = harness.resolve(1);
      await buffer.whenPresentationReadyAhead(1);
      await expect(buffer.present(1)).resolves.toBe(frame);
      expect(compressedFrameFetch).toHaveBeenCalledExactlyOnceWith(
        "/frame-1.sog",
        expect.anything(),
      );
    } finally {
      buffer.dispose();
    }
  });

  it("prepares the smallest flat tier that satisfies presentation quality", () => {
    const harness = createRendererHarness();
    const sequence = createSequence(1);
    sequence.frames[0] = {
      ...sequence.frames[0]!,
      qualityLevels: [
        {
          byteSize: 100,
          detailLevel: 0.1,
          level: 0,
          url: "/frame-0-preview.spz",
        },
        {
          byteSize: 250,
          detailLevel: 0.25,
          level: 1,
          minimumPlayable: true,
          splatCount: 2_500,
          url: "/frame-0-minimum.spz",
        },
      ],
    };
    const buffer = new FrameRingBuffer({
      futureFrameCount: 0,
      presentationQualityTarget: {
        detailLevel: 0.1,
        minimumSplatCount: 100,
      },
      renderer: harness.renderer,
      sequence,
    });

    void buffer.initialise(0).catch(() => undefined);

    expect(harness.renderer.prepareFrame).toHaveBeenCalledWith(
      "actor",
      expect.objectContaining({
        byteSize: 250,
        url: "/frame-0-minimum.spz",
      }),
      expect.objectContaining({
        targetQualityLevel: 1,
        transferQuality: {
          detailLevel: 0.25,
          level: 1,
          mode: "fixed",
          splatCount: 2_500,
        },
      }),
    );
    buffer.dispose();
  });

  it("follows a replacement flat tier while a caller waits for the frame", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(2);
    sequence.frames = sequence.frames.map((frame) => ({
      ...frame,
      qualityLevels: [
        {
          byteSize: 250,
          detailLevel: 0.25,
          level: 0,
          minimumPlayable: true,
          url: `/frame-${frame.frameIndex}-minimum.spz`,
        },
        {
          byteSize: 500,
          detailLevel: 0.5,
          level: 1,
          url: `/frame-${frame.frameIndex}-medium.spz`,
        },
      ],
    }));
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      maximumBasePreparationConcurrency: 1,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence,
    });

    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await initialising;
    await vi.waitFor(() => {
      expect(
        harness.prepareFrame.mock.calls.filter(([, source]) => source.frameIndex === 1),
      ).toHaveLength(1);
    });
    const waitingForBuffer = buffer.whenBuffered();
    buffer.setPresentationQualityTarget({
      detailLevel: 0.5,
      minimumSplatCount: 2,
    });
    await vi.waitFor(() => {
      expect(
        harness.prepareFrame.mock.calls.filter(([, source]) => source.frameIndex === 1),
      ).toHaveLength(2);
    });
    harness.resolve(1);

    await expect(waitingForBuffer).resolves.toBeUndefined();
    expect(harness.prepareFrame).toHaveBeenCalledWith(
      "actor",
      expect.objectContaining({
        url: "/frame-1-medium.spz",
      }),
      expect.objectContaining({
        transferQuality: expect.objectContaining({
          detailLevel: 0.5,
          mode: "fixed",
        }),
      }),
    );
    buffer.dispose();
  });

  it.each([
    [0.25, 1],
    [1, 0.25],
  ])(
    "preserves prepared frames switching automatically from %s to %s",
    async (initialDetail, nextDetail) => {
      const harness = createRendererHarness();
      const sequence = createSequence(2);
      sequence.frames = sequence.frames.map((frame) => ({
        ...frame,
        qualityLevels: [0.25, 1].map((detailLevel, level) => ({
          detailLevel,
          level,
          minimumPlayable: level === 0,
          url: `/frame-${frame.frameIndex}-${detailLevel}.sog`,
        })),
      }));
      // Fixed assets cannot refine in place: report their original detail throughout.
      for (const index of [0, 1])
        harness.presentationQualities.set(index, {
          detailLevel: initialDetail,
          selectedSplatCount: 1_000,
          state: "presentable",
        });
      harness.refineFrame.mockImplementation(async (frame) =>
        harness.presentationQualities.get(frame.frameIndex)!,
      );
      const buffer = new FrameRingBuffer({
        futureFrameCount: 1,
        previousFrameCount: 0,
        loop: true,
        presentationQualityTarget: { detailLevel: initialDetail, minimumSplatCount: 2 },
        renderer: harness.renderer,
        sequence,
      });
      const initialising = buffer.initialise(0);
      const first = harness.resolve(0);
      await initialising;
      const next = harness.resolve(1);
      await buffer.whenBuffered();
      buffer.setPresentationQualityTarget(
        { detailLevel: nextDetail, minimumSplatCount: 2 },
        { preservePreparedFrames: true },
      );
      expect(harness.releaseFrame).not.toHaveBeenCalledWith(next);
      expect(buffer.isPresentationReady(1)).toBe(true);
      expect(harness.prepareFrame).toHaveBeenCalledTimes(2);
      await expect(buffer.present(1)).resolves.toBe(next);
      expect(harness.releaseFrame).toHaveBeenCalledWith(first);
      // Even when the whole clip fits in the ring, consumed frames adopt the new tier.
      expect(harness.prepareFrame).toHaveBeenLastCalledWith(
        "actor",
        expect.objectContaining({
          frameIndex: 0,
          url: `/frame-0-${nextDetail}.sog`,
        }),
        expect.anything(),
      );
      buffer.dispose();
    },
  );

  it("replaces the formerly presented tier after a safe handoff", async () => {
    const harness = createRendererHarness();
    const sequence = createSequence(2);
    sequence.frames = sequence.frames.map((frame) => ({
      ...frame,
      qualityLevels: [
        {
          detailLevel: 0.25,
          level: 0,
          minimumPlayable: true,
          url: `/frame-${frame.frameIndex}-minimum.spz`,
        },
        {
          detailLevel: 1,
          level: 1,
          url: `/frame-${frame.frameIndex}-full.spz`,
        },
      ],
    }));
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      loop: true,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence,
    });

    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await initialising;
    harness.resolve(1);
    await buffer.whenBuffered();

    buffer.setPresentationQualityTarget({
      detailLevel: 1,
      minimumSplatCount: 2,
    });
    await vi.waitFor(() => {
      expect(
        harness.prepareFrame.mock.calls.filter(
          ([, source]) => source.frameIndex === 1 && source.url === "/frame-1-full.spz",
        ),
      ).toHaveLength(1);
    });
    harness.resolve(1);
    await buffer.present(1);

    await vi.waitFor(() => {
      expect(
        harness.prepareFrame.mock.calls.filter(
          ([, source]) => source.frameIndex === 0 && source.url === "/frame-0-full.spz",
        ),
      ).toHaveLength(1);
    });
    buffer.dispose();
  });

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

  it("does not publish a frame until an asynchronous renderer handoff completes", async () => {
    const harness = createRendererHarness();
    const handoff = deferred<void>();
    harness.presentFrame.mockImplementation(() => handoff.promise);
    const buffer = new FrameRingBuffer({
      futureFrameCount: 0,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(1),
    });

    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await vi.waitFor(() => expect(harness.presentFrame).toHaveBeenCalledOnce());
    expect(buffer.snapshot.currentFrameIndex).toBeUndefined();
    expect(
      buffer.snapshot.frames.find(({ frameIndex }) => frameIndex === 0)?.status,
    ).not.toBe("presented");

    handoff.resolve();
    await initialising;
    expect(buffer.snapshot.currentFrameIndex).toBe(0);
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
    const firstPresentationRejected = expect(firstPresentation).rejects.toMatchObject({
      name: "AbortError",
    });
    harness.resolve(1);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(1)).toBe(true));

    const secondPresentation = buffer.present(2);
    const frame2 = harness.resolve(2);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(2)).toBe(true));
    harness.resolveQuality(2);
    await secondPresentation;

    harness.resolveQuality(1);
    await firstPresentationRejected;
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame2);
    expect(buffer.snapshot.currentFrameIndex).toBe(2);
  });

  it("updates prepared and loading frames and uses the transform for future frames", async () => {
    const harness = createRendererHarness();
    const buffer = new FrameRingBuffer({
      futureFrameCount: 2,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    const frame0 = harness.resolve(0);
    await initialising;
    const frame1 = harness.resolve(1);
    await vi.waitFor(() => {
      expect(
        buffer.snapshot.frames.find(({ frameIndex }) => frameIndex === 1),
      ).toMatchObject({ status: "base-ready" });
    });
    const transform = {
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.5, z: 1.5 },
    };

    buffer.setTransform(transform);

    expect(harness.setFrameTransform).toHaveBeenCalledWith(frame0, transform);
    expect(harness.setFrameTransform).toHaveBeenCalledWith(frame1, transform);
    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame0, false);

    const frame2 = harness.resolve(2);
    await buffer.whenBuffered();
    expect(harness.setFrameTransform).toHaveBeenCalledWith(frame2, transform);

    await buffer.present(1);
    expect(harness.renderer.prepareFrame).toHaveBeenCalledWith(
      "actor",
      expect.objectContaining({ frameIndex: 3 }),
      expect.objectContaining({ transform }),
    );
  });

  it("revalidates an in-flight presentation after its transform changes", async () => {
    const harness = createRendererHarness({ automaticQuality: false });
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(),
    });
    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(0)).toBe(true));
    harness.resolveQuality(0);
    await initialising;

    const switching = buffer.present(1);
    const frame1 = harness.resolve(1);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(1)).toBe(true));
    const transform = {
      rotation: { w: 0, x: 1, y: 0, z: 0 },
      scale: { x: 0.8, y: 0.8, z: 0.8 },
    };

    buffer.setTransform(transform);
    await vi.waitFor(() => {
      expect(
        harness.refineFrame.mock.calls.filter(([frame]) => frame === frame1),
      ).toHaveLength(2);
    });
    harness.resolveQuality(1);

    await expect(switching).resolves.toBe(frame1);
    expect(harness.presentFrame).toHaveBeenLastCalledWith(frame1);
    expect(harness.setFrameTransform).toHaveBeenCalledWith(frame1, transform);
  });

  it("reports preparation, refinement, and presentation timings without affecting playback", async () => {
    const harness = createRendererHarness();
    const events: FrameRingBufferTraceEvent[] = [];
    let now = 100;
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      now: () => now,
      onTrace: (event) => events.push(event),
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(),
    });

    const initialising = buffer.initialise(0);
    now = 125;
    harness.resolve(0);
    await initialising;

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ frameIndex: 0, type: "base-requested" }),
        expect.objectContaining({
          durationMs: 1,
          frameIndex: 0,
          phase: "resource-created",
          type: "renderer-phase",
        }),
        expect.objectContaining({
          durationMs: 25,
          frameIndex: 0,
          type: "base-ready",
        }),
        expect.objectContaining({
          frameIndex: 0,
          type: "refinement-started",
        }),
        expect.objectContaining({
          frameIndex: 0,
          quality: expect.objectContaining({
            detailLevel: 0.25,
            state: "presentable",
          }),
          type: "presentation-ready",
        }),
        expect.objectContaining({ frameIndex: 0, type: "presented" }),
      ]),
    );
    expect(harness.presentFrame).toHaveBeenCalledOnce();
  });

  it("revalidates buffered frames when adaptive presentation targets change", async () => {
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
    await buffer.whenBuffered();
    await vi.waitFor(() => {
      expect(
        buffer.snapshot.frames.find(({ frameIndex }) => frameIndex === 1)?.status,
      ).toBe("ready");
    });

    buffer.setPresentationQualityTarget({
      detailLevel: 0.15,
      minimumSplatCount: 50,
    });

    expect(harness.setFrameRefinement).toHaveBeenCalledWith(frame1, false);
    await vi.waitFor(() => {
      expect(harness.refineFrame).toHaveBeenCalledWith(
        frame1,
        { detailLevel: 0.15, minimumSplatCount: 50 },
        expect.anything(),
      );
    });
  });

  it("retries a loop-boundary readiness wait when adaptive quality supersedes refinement", async () => {
    const harness = createRendererHarness({ automaticQuality: false });
    const buffer = new FrameRingBuffer({
      futureFrameCount: 1,
      loop: true,
      previousFrameCount: 0,
      renderer: harness.renderer,
      sequence: createSequence(3),
    });
    const initialising = buffer.initialise(0);
    harness.resolve(0);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(0)).toBe(true));
    harness.resolveQuality(0);
    await initialising;

    const movingToLastFrame = buffer.present(2);
    harness.resolve(2);
    await vi.waitFor(() => expect(harness.qualityPreparations.has(2)).toBe(true));
    harness.resolveQuality(2);
    await movingToLastFrame;

    harness.presentationQualities.set(0, {
      detailLevel: 0,
      selectedSplatCount: 1,
      state: "root-ready",
    });
    const waitingForWrappedFrame = buffer.whenPresentationReadyAhead(1);
    await vi.waitFor(() => {
      expect(
        harness.refineFrame.mock.calls.filter(([frame]) => frame.frameIndex === 0),
      ).toHaveLength(2);
    });

    buffer.setPresentationQualityTarget({
      detailLevel: 0.15,
      minimumSplatCount: 2,
    });
    await vi.waitFor(() => {
      expect(
        harness.refineFrame.mock.calls.filter(([frame]) => frame.frameIndex === 0),
      ).toHaveLength(3);
    });
    harness.resolveQuality(0);

    await expect(waitingForWrappedFrame).resolves.toBeUndefined();
    expect(buffer.isPresentationReady(0)).toBe(true);
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
