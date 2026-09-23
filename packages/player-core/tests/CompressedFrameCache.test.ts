import { describe, expect, it, vi } from "vitest";

import { CompressedFrameCache } from "../src/index.js";

import type { CompressedFrameCacheTraceEvent } from "../src/index.js";

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

function response(byteLength: number): Response {
  return new Response(new Uint8Array(byteLength));
}

describe("CompressedFrameCache", () => {
  it.each([
    [0, 8, true],
    [0, 0, undefined],
    [308, 8, false],
  ])(
    "distinguishes cache hits from hidden cross-origin sizes (%s / %s)",
    async (transferSize, decodedBodySize, fromCache) => {
      const timing = vi.spyOn(performance, "getEntriesByName").mockReturnValue([
        {
          startTime: 0,
          connectStart: 0,
          connectEnd: 0,
          nextHopProtocol: "h2",
          transferSize,
          decodedBodySize,
        } as PerformanceResourceTiming,
      ]);
      const trace: CompressedFrameCacheTraceEvent[] = [];
      const cache = new CompressedFrameCache({
        fetch: vi.fn(async () => response(8)),
        maximumBytes: 8,
        now: () => 0,
        onTrace: (event) => trace.push(event),
      });
      try {
        await cache.get({ frameIndex: 0, url: "/frame.sog" });
        expect(trace.find(({ type }) => type === "fetch-ready")?.fromCache).toBe(
          fromCache,
        );
      } finally {
        cache.dispose();
        timing.mockRestore();
      }
    },
  );
  it("separates response latency from response body processing", async () => {
    let now = 0;
    const trace: CompressedFrameCacheTraceEvent[] = [];
    const fetchImplementation = vi.fn(async () => {
      now = 12;
      return {
        ok: true,
        arrayBuffer: async () => {
          now = 32;
          return new ArrayBuffer(8);
        },
      } as Response;
    });
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 8,
      maximumFetchConcurrency: 1,
      now: () => now,
      onTrace: (event) => trace.push({ ...event }),
    });

    await cache.get({ byteSize: 8, frameIndex: 0, url: "/frame-0.spz" });

    expect(trace.find(({ type }) => type === "fetch-ready")).toMatchObject({
      bodyReadMs: 20,
      durationMs: 32,
      responseLatencyMs: 12,
    });
    cache.dispose();
  });

  it("invokes fetch with the browser global receiver", async () => {
    const fetchImplementation = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(response(4));
    });
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 4,
      maximumFetchConcurrency: 1,
    });

    await expect(
      cache.get({ byteSize: 4, frameIndex: 0, url: "/frame-0.spz" }),
    ).resolves.toHaveProperty("byteLength", 4);
    cache.dispose();
  });

  it("fetches ahead independently with bounded network concurrency", async () => {
    const pending = Array.from({ length: 4 }, () => deferred<Response>());
    const fetchImplementation = vi.fn(
      async () => pending[fetchImplementation.mock.calls.length - 1]!.promise,
    );
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 40,
      maximumFetchConcurrency: 2,
    });

    cache.setPlan(
      Array.from({ length: 4 }, (_, frameIndex) => ({
        byteSize: 10,
        frameIndex,
        url: `/frame-${frameIndex}.spz`,
      })),
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(cache.snapshot).toMatchObject({
      activeFetchCount: 2,
      queuedFetchCount: 2,
    });

    pending[0]!.resolve(response(10));
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(3));
    expect(cache.snapshot.readyFrameCount).toBe(1);

    cache.dispose();
  });

  it("limits the forward plan by compressed byte budget", () => {
    const fetchImplementation = vi.fn(async () => response(10));
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 20,
      maximumFetchConcurrency: 4,
    });

    cache.setPlan(
      Array.from({ length: 5 }, (_, frameIndex) => ({
        byteSize: 10,
        frameIndex,
        url: `/frame-${frameIndex}.spz`,
      })),
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it("enforces the hard budget when responses exceed declared sizes", async () => {
    const fetchImplementation = vi.fn(async () => response(10));
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 20,
      maximumFetchConcurrency: 4,
    });

    cache.setPlan(
      Array.from({ length: 4 }, (_, frameIndex) => ({
        byteSize: 5,
        frameIndex,
        url: `/frame-${frameIndex}.spz`,
      })),
    );

    await vi.waitFor(() => expect(cache.snapshot.activeFetchCount).toBe(0));
    expect(cache.snapshot).toMatchObject({
      readyFrameCount: 2,
      residentBytes: 20,
    });
    cache.dispose();
  });

  it("deduplicates demand and does not abort shared prefetch for one caller", async () => {
    const pending = deferred<Response>();
    let fetchSignal: AbortSignal | undefined;
    const fetchImplementation = vi.fn(async (...args: Parameters<typeof fetch>) => {
      fetchSignal = args[1]?.signal as AbortSignal | undefined;
      return pending.promise;
    });
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 20,
      maximumFetchConcurrency: 1,
    });
    const request = { byteSize: 10, frameIndex: 0, url: "/frame-0.spz" };
    cache.setPlan([request]);
    const caller = new AbortController();
    const first = cache.get(request, caller.signal);
    const second = cache.get(request);

    caller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSignal?.aborted).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledOnce();

    pending.resolve(response(10));
    await expect(second).resolves.toHaveProperty("byteLength", 10);
    cache.dispose();
  });

  it("rejects fetching and queued callers when disposed", async () => {
    const pending = deferred<Response>();
    const fetchImplementation = vi.fn(async () => pending.promise);
    const cache = new CompressedFrameCache({
      fetch: fetchImplementation,
      maximumBytes: 20,
      maximumFetchConcurrency: 1,
    });
    const first = cache.get({ byteSize: 10, frameIndex: 0, url: "/frame-0.spz" });
    const second = cache.get({ byteSize: 10, frameIndex: 1, url: "/frame-1.spz" });
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledOnce());

    cache.dispose();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve(response(10));
    await vi.waitFor(() => expect(cache.snapshot.activeFetchCount).toBe(0));
  });
});
