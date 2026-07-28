import { describe, expect, it, vi } from "vitest";

import { PlayCanvasGpuTimingSampler } from "../src/gpuTimingSampler.js";

import type { Application } from "playcanvas";

type Listener = () => void;

function createApplication(
  profiler: {
    enabled: boolean;
    passTimings: Map<string, number>;
    report(renderVersion: unknown, timings: unknown, frameTime: unknown): void;
    timestampQueriesSet: unknown;
  },
  supportsTimestampQuery = true,
) {
  const listeners = new Map<string, Set<Listener>>();
  const subscribe = (name: string, listener: Listener, once: boolean) => {
    const callbacks = listeners.get(name) ?? new Set<Listener>();
    let active = true;
    const wrapped = () => {
      if (!active) {
        return;
      }
      if (once) {
        active = false;
        callbacks.delete(wrapped);
      }
      listener();
    };
    callbacks.add(wrapped);
    listeners.set(name, callbacks);
    return {
      off(): void {
        active = false;
        callbacks.delete(wrapped);
      },
    };
  };
  return {
    application: {
      graphicsDevice: {
        gpuProfiler: profiler,
        isWebGPU: true,
        supportsTimestampQuery,
      },
      on: vi.fn((name: string, listener: Listener) => subscribe(name, listener, false)),
      once: vi.fn((name: string, listener: Listener) =>
        subscribe(name, listener, true),
      ),
    } as unknown as Application,
    fire(name: string): void {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        listener();
      }
    },
  };
}

describe("PlayCanvasGpuTimingSampler", () => {
  it("captures bounded two-frame bursts and aggregates named GPU passes", () => {
    const passTimings = new Map<string, number>();
    let nextPassTimings: readonly (readonly [string, number])[] = [];
    const originalReport = vi.fn((...reportArguments: [unknown, unknown, unknown]) => {
      void reportArguments;
      passTimings.clear();
      for (const [name, value] of nextPassTimings) {
        passTimings.set(name, value);
      }
    });
    const profiler = {
      enabled: false,
      passTimings,
      report: originalReport,
      timestampQueriesSet: {},
    };
    const { application, fire } = createApplication(profiler);
    let now = 0;
    const sampler = new PlayCanvasGpuTimingSampler(application, 2_000, () => now);

    sampler.requestSample();
    expect(profiler.enabled).toBe(true);
    fire("prerender");

    nextPassTimings = [
      ["Forward", 3],
      ["Sort", 2],
    ];
    profiler.report(1, [3, 2], 6);
    fire("frameend");
    expect(profiler.enabled).toBe(true);

    nextPassTimings = [
      ["Forward", 2],
      ["Sort", 4],
    ];
    profiler.report(2, [2, 4], 8);
    fire("frameend");
    expect(profiler.enabled).toBe(false);

    expect(sampler.getSnapshot()).toMatchObject({
      capturedFrameCount: 2,
      frameTime: {
        latestMs: 8,
        maxMs: 8,
        p50Ms: 6,
        p95Ms: 8,
        sampleCount: 2,
      },
      status: "ready",
    });
    expect(sampler.getSnapshot().passTimings).toEqual([
      {
        latestMs: 4,
        maxMs: 4,
        name: "Sort",
        p50Ms: 2,
        p95Ms: 4,
        sampleCount: 2,
      },
      {
        latestMs: 2,
        maxMs: 3,
        name: "Forward",
        p50Ms: 2,
        p95Ms: 3,
        sampleCount: 2,
      },
      {
        latestMs: 2,
        maxMs: 2,
        name: "Unattributed / transfers",
        p50Ms: 1,
        p95Ms: 2,
        sampleCount: 2,
      },
    ]);

    sampler.requestSample();
    expect(profiler.enabled).toBe(false);
    now = 2_000;
    sampler.requestSample();
    expect(profiler.enabled).toBe(true);

    sampler.dispose();
    expect(profiler.enabled).toBe(false);
    expect(profiler.report).toBe(originalReport);
  });

  it("reports missing WebGPU timestamp support without enabling the profiler", () => {
    const profiler = {
      enabled: false,
      passTimings: new Map<string, number>(),
      report: vi.fn(),
      timestampQueriesSet: null,
    };
    const { application } = createApplication(profiler, false);
    const sampler = new PlayCanvasGpuTimingSampler(application, 2_000, () => 0);

    sampler.requestSample();

    expect(profiler.enabled).toBe(false);
    expect(sampler.getSnapshot()).toMatchObject({
      capturedFrameCount: 0,
      reason: expect.stringMatching(/timestamp-query/i),
      status: "unsupported",
    });
  });

  it("stays disabled when the sampling interval is zero", () => {
    const profiler = {
      enabled: false,
      passTimings: new Map<string, number>(),
      report: vi.fn(),
      timestampQueriesSet: {},
    };
    const { application } = createApplication(profiler);
    const sampler = new PlayCanvasGpuTimingSampler(application, 0, () => 0);

    sampler.requestSample();

    expect(profiler.enabled).toBe(false);
    expect(sampler.getSnapshot().status).toBe("disabled");
  });
});
