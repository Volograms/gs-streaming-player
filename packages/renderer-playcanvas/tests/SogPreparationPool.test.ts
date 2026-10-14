import { describe, expect, it, vi } from "vitest";

import {
  SogPreparationPool,
  SogWorkerUnavailableError,
} from "../src/SogPreparationPool.js";

import type {
  SogPreparationRequest,
  SogPreparationResponse,
} from "../src/sog/sogPreparation.protocol.js";
import type { SogWorkerLike } from "../src/SogPreparationPool.js";

class FakeWorker implements SogWorkerLike {
  onmessage: SogWorkerLike["onmessage"] = null;
  onerror: SogWorkerLike["onerror"] = null;
  onmessageerror: SogWorkerLike["onmessageerror"] = null;
  requests: SogPreparationRequest[] = [];
  postMessage = vi.fn((request: SogPreparationRequest) => this.requests.push(request));
  terminate = vi.fn();
  respond(response: SogPreparationResponse) {
    this.onmessage?.({ data: response } as MessageEvent<SogPreparationResponse>);
  }
}

describe("SogPreparationPool", () => {
  it("overlaps four frames per worker, bounds dispatch, and retains compressed buffers", async () => {
    const { pool, workers } = harness(2);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const pending = Array.from({ length: 9 }, () => pool.prepare(bytes));
    expect(workers.map((worker) => worker.requests.length)).toEqual([4, 4]);
    for (const worker of workers)
      for (const call of worker.postMessage.mock.calls) expect(call).toHaveLength(1);
    workers[0]!.respond(success(1));
    expect(workers[0]!.requests).toHaveLength(5);
    for (let id = 2; id <= 9; id += 1)
      workers
        .find((worker) => worker.requests.some((request) => request.id === id))!
        .respond(success(id));
    await Promise.all(pending);
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
    pool.dispose();
  });

  it("cancels queued and active work, closes late images, and keeps other jobs alive", async () => {
    const {
      pool,
      workers: [worker],
    } = harness();
    const active = new AbortController();
    const queued = new AbortController();
    const first = pool.prepare(new ArrayBuffer(1), active.signal);
    const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const others = Array.from({ length: 3 }, () => pool.prepare(new ArrayBuffer(1)));
    const last = pool.prepare(new ArrayBuffer(1), queued.signal);
    const lastRejected = expect(last).rejects.toMatchObject({ name: "AbortError" });
    active.abort();
    queued.abort();
    await Promise.all([firstRejected, lastRejected]);
    expect(
      worker!.requests.filter((request) => request.type === "prepare"),
    ).toHaveLength(4);
    expect(worker!.requests.at(-1)).toEqual({ type: "cancel", id: 1 });
    const late = success(1);
    worker!.respond(late);
    expect(late.result.images[0]!.bitmap.close).toHaveBeenCalledOnce();
    for (let id = 2; id <= 4; id += 1) worker!.respond(success(id));
    await Promise.all(others);
    expect(worker!.terminate).not.toHaveBeenCalled();
    pool.dispose();
  });

  it("falls back after worker startup/crash and rejects all pending jobs", async () => {
    const {
      pool,
      workers: [worker],
    } = harness();
    const pending = Array.from({ length: 5 }, () => pool.prepare(new ArrayBuffer(1)));
    const rejected = pending.map((promise) =>
      expect(promise).rejects.toBeInstanceOf(SogWorkerUnavailableError),
    );
    worker!.onerror?.({
      message: "worker blocked",
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent);
    await Promise.all(rejected);
    expect(pool.workerCount).toBe(0);
    expect(worker!.terminate).toHaveBeenCalledOnce();
    await expect(pool.prepare(new ArrayBuffer(1))).rejects.toBeInstanceOf(
      SogWorkerUnavailableError,
    );
    pool.dispose();
  });

  it("disposes queued and active jobs and closes an already-transferred late result", async () => {
    const {
      pool,
      workers: [worker],
    } = harness();
    const pending = Array.from({ length: 5 }, () => pool.prepare(new ArrayBuffer(1)));
    const rejected = pending.map((promise) =>
      expect(promise).rejects.toThrow(/disposed/),
    );
    pool.dispose();
    pool.dispose();
    await Promise.all(rejected);
    const late = success(1);
    worker!.respond(late);
    expect(late.result.images[0]!.bitmap.close).toHaveBeenCalledOnce();
    expect(worker!.terminate).toHaveBeenCalledOnce();
  });

  it("handles worker construction failure and capability fallback without retrying", async () => {
    const factory = vi.fn(() => {
      throw new Error("CSP");
    });
    const failed = new SogPreparationPool({
      maximumWorkers: 1,
      workerFactory: factory,
    });
    await expect(failed.prepare(new ArrayBuffer(1))).rejects.toBeInstanceOf(
      SogWorkerUnavailableError,
    );
    expect(factory).toHaveBeenCalledOnce();
    failed.dispose();
    const {
      pool,
      workers: [worker],
    } = harness();
    const pending = pool.prepare(new ArrayBuffer(1));
    const rejected = expect(pending).rejects.toBeInstanceOf(SogWorkerUnavailableError);
    worker!.respond({
      id: 1,
      ok: false,
      unsupported: true,
      unavailable: true,
      error: "ImageBitmap unsupported",
    });
    await rejected;
    expect(pool.workerCount).toBe(0);
    pool.dispose();
  });
});

function harness(maximumWorkers = 1) {
  const workers: FakeWorker[] = [];
  const pool = new SogPreparationPool({
    maximumWorkers,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

function success(id: number): Extract<SogPreparationResponse, { ok: true }> {
  return {
    id,
    ok: true,
    workerDurationMs: 1,
    result: {
      meta: {
        count: 1,
        means: { files: [] },
        scales: { files: [] },
        quats: { files: [] },
        sh0: { files: [] },
      },
      images: [
        {
          name: "image.webp",
          bitmap: { width: 1, height: 1, close: vi.fn() } as ImageBitmap,
        },
      ],
      unpackDurationMs: 0.2,
      imageDecodeDurationMs: 0.8,
    },
  };
}
