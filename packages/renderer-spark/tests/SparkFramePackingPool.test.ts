import { describe, expect, it } from "vitest";

import { SparkFramePackingPool } from "../src/SparkFramePackingPool.js";

import type {
  SparkFramePackingRequest,
  SparkFramePackingResponse,
} from "../src/sparkFramePacking.protocol.js";
import type { SparkPackingWorkerLike } from "../src/SparkFramePackingPool.js";
import type { SparkPackedFramePayload } from "../src/sparkPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

class FakeWorker implements SparkPackingWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<SparkFramePackingResponse>) => void) | null = null;
  readonly requests: SparkFramePackingRequest[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;

  postMessage(message: SparkFramePackingRequest, transfer: Transferable[]): void {
    this.requests.push(message);
    this.transfers.push(transfer);
  }

  respond(payload: SparkPackedFramePayload, workerDurationMs = 4): void {
    const request = this.requests.at(-1);
    if (request === undefined) {
      throw new Error("No request to resolve.");
    }
    this.onmessage?.({
      data: { id: request.id, ok: true, payload, workerDurationMs },
    } as MessageEvent<SparkFramePackingResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function frame(): DecodedGaussianFrame {
  return {
    alphas: new Float32Array([1]),
    antialiased: false,
    codecId: "test",
    colors: new Float32Array([1, 1, 1]),
    coordinateSystem: "RUB",
    numSplats: 1,
    positions: new Float32Array([1, 2, 3]),
    rotations: new Float32Array([0, 0, 0, 1]),
    scales: new Float32Array([1, 1, 1]),
    shDegree: 0,
    sphericalHarmonics: new Float32Array(),
  };
}

function payload(): SparkPackedFramePayload {
  return {
    maxSplats: 2_048,
    numSplats: 1,
    packedArray: new Uint32Array(2_048 * 4),
    shDegree: 0,
  };
}

describe("SparkFramePackingPool", () => {
  it("transfers neutral buffers and reports worker lifecycle timing", async () => {
    const workers: FakeWorker[] = [];
    const times = [10, 12, 20];
    const pool = new SparkFramePackingPool({
      maximumWorkers: 1,
      now: () => times.shift() ?? 20,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const source = frame();
    const resultPromise = pool.pack(source);

    expect(workers[0]?.requests).toHaveLength(1);
    expect(workers[0]?.transfers).toHaveLength(1);
    expect(workers[0]?.transfers[0]).toContain(source.positions.buffer);
    workers[0]?.respond(payload(), 4);

    await expect(resultPromise).resolves.toMatchObject({
      execution: "worker",
      queueDurationMs: 2,
      resultTransferDurationMs: 4,
      totalDurationMs: 10,
      workerDurationMs: 4,
    });
    pool.dispose();
  });

  it("bounds concurrent packing and starts the next queued frame", async () => {
    const worker = new FakeWorker();
    const pool = new SparkFramePackingPool({
      maximumWorkers: 1,
      now: () => 0,
      workerFactory: () => worker,
    });
    const first = pool.pack(frame());
    const second = pool.pack(frame());

    expect(worker.requests).toHaveLength(1);
    worker.respond(payload());
    await first;
    expect(worker.requests).toHaveLength(2);
    worker.respond(payload());
    await second;
    pool.dispose();
  });

  it("cancels active work by replacing its worker", async () => {
    const workers: FakeWorker[] = [];
    const pool = new SparkFramePackingPool({
      maximumWorkers: 1,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const controller = new AbortController();
    const result = pool.pack(frame(), { signal: controller.signal });

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    pool.dispose();
  });
});
