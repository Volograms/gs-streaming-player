import { packDecodedGaussianFramePayload } from "./sparkPackedFrame.js";

import type {
  SparkFramePackingRequest,
  SparkFramePackingResponse,
} from "./sparkFramePacking.protocol.js";
import type { SparkPackedFramePayload } from "./sparkPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface SparkFramePackingResult {
  execution: "main-thread" | "worker";
  payload: SparkPackedFramePayload;
  queueDurationMs: number;
  resultTransferDurationMs: number;
  totalDurationMs: number;
  workerDurationMs: number;
}

export interface SparkFramePackingOptions {
  signal?: AbortSignal;
}

export interface SparkFramePacker {
  dispose?(): void;
  pack(
    frame: DecodedGaussianFrame,
    options?: SparkFramePackingOptions,
  ): Promise<SparkFramePackingResult>;
}

export interface SparkPackingWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<SparkFramePackingResponse>) => void) | null;
  postMessage(message: SparkFramePackingRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface PackingJob {
  frame: DecodedGaussianFrame;
  id: number;
  queuedAt: number;
  reject(error: unknown): void;
  resolve(result: SparkFramePackingResult): void;
  signal?: AbortSignal;
  startedAt?: number;
}

interface WorkerSlot {
  job?: PackingJob;
  worker: SparkPackingWorkerLike;
}

export interface SparkFramePackingPoolOptions {
  maximumWorkers?: number;
  now?: () => number;
  workerFactory?: () => SparkPackingWorkerLike;
}

/** Spark-owned persistent workers converting neutral attributes to renderer payloads. */
export class SparkFramePackingPool implements SparkFramePacker {
  private disposed = false;
  private nextJobId = 1;
  private readonly now: () => number;
  private readonly queue: PackingJob[] = [];
  private readonly slots: WorkerSlot[];
  private readonly workerFactory: () => SparkPackingWorkerLike;

  constructor(options: SparkFramePackingPoolOptions = {}) {
    const maximumWorkers = options.maximumWorkers ?? 2;
    if (!Number.isInteger(maximumWorkers) || maximumWorkers <= 0) {
      throw new RangeError("maximumWorkers must be a positive integer.");
    }
    this.now = options.now ?? (() => performance.now());
    this.workerFactory = options.workerFactory ?? createBrowserPackingWorker;
    this.slots = Array.from({ length: maximumWorkers }, () => this.createSlot());
  }

  pack(
    frame: DecodedGaussianFrame,
    options: SparkFramePackingOptions = {},
  ): Promise<SparkFramePackingResult> {
    if (this.disposed) {
      return Promise.reject(new Error("The Spark frame packing pool was disposed."));
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    return new Promise<SparkFramePackingResult>((resolve, reject) => {
      const job: PackingJob = {
        frame,
        id: this.nextJobId,
        queuedAt: this.now(),
        reject,
        resolve,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      this.nextJobId += 1;
      const abort = () => this.abortJob(job);
      options.signal?.addEventListener("abort", abort, { once: true });
      const originalResolve = job.resolve;
      const originalReject = job.reject;
      job.resolve = (result) => {
        options.signal?.removeEventListener("abort", abort);
        originalResolve(result);
      };
      job.reject = (error) => {
        options.signal?.removeEventListener("abort", abort);
        originalReject(error);
      };
      this.queue.push(job);
      this.dispatch();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const job of this.queue.splice(0)) {
      job.reject(new Error("The Spark frame packing pool was disposed."));
    }
    for (const slot of this.slots) {
      slot.job?.reject(new Error("The Spark frame packing pool was disposed."));
      slot.worker.terminate();
      delete slot.job;
    }
  }

  private abortJob(job: PackingJob): void {
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      job.reject(abortError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.job === job);
    if (slot === undefined) {
      return;
    }
    slot.worker.terminate();
    job.reject(abortError());
    delete slot.job;
    if (!this.disposed) {
      slot.worker = this.configureWorker(slot, this.workerFactory());
      this.dispatch();
    }
  }

  private createSlot(): WorkerSlot {
    const slot = {} as WorkerSlot;
    slot.worker = this.configureWorker(slot, this.workerFactory());
    return slot;
  }

  private configureWorker(
    slot: WorkerSlot,
    worker: SparkPackingWorkerLike,
  ): SparkPackingWorkerLike {
    worker.onmessage = ({ data }) => {
      const job = slot.job;
      if (job === undefined || data.id !== job.id) {
        return;
      }
      delete slot.job;
      if (data.ok) {
        const completedAt = this.now();
        const queueDurationMs = (job.startedAt ?? job.queuedAt) - job.queuedAt;
        const totalDurationMs = completedAt - job.queuedAt;
        job.resolve({
          execution: "worker",
          payload: data.payload,
          queueDurationMs,
          resultTransferDurationMs: Math.max(
            0,
            totalDurationMs - queueDurationMs - data.workerDurationMs,
          ),
          totalDurationMs,
          workerDurationMs: data.workerDurationMs,
        });
      } else {
        job.reject(new Error(data.error));
      }
      this.dispatch();
    };
    worker.onerror = (event) => {
      const job = slot.job;
      delete slot.job;
      job?.reject(new Error(event.message || "Spark frame packing worker failed."));
      worker.terminate();
      if (!this.disposed) {
        slot.worker = this.configureWorker(slot, this.workerFactory());
        this.dispatch();
      }
    };
    return worker;
  }

  private dispatch(): void {
    if (this.disposed) {
      return;
    }
    for (const slot of this.slots) {
      if (slot.job !== undefined) {
        continue;
      }
      const job = this.queue.shift();
      if (job === undefined) {
        return;
      }
      if (job.signal?.aborted === true) {
        job.reject(abortError());
        this.dispatch();
        return;
      }
      slot.job = job;
      job.startedAt = this.now();
      try {
        slot.worker.postMessage(
          { frame: job.frame, id: job.id },
          decodedFrameTransferList(job.frame),
        );
      } catch (error) {
        delete slot.job;
        job.reject(error);
        slot.worker.terminate();
        slot.worker = this.configureWorker(slot, this.workerFactory());
        this.dispatch();
      }
    }
  }
}

export class SynchronousSparkFramePacker implements SparkFramePacker {
  constructor(private readonly now: () => number = () => performance.now()) {}

  async pack(
    frame: DecodedGaussianFrame,
    options: SparkFramePackingOptions = {},
  ): Promise<SparkFramePackingResult> {
    if (options.signal?.aborted === true) {
      throw abortError();
    }
    const startedAt = this.now();
    const payload = packDecodedGaussianFramePayload(frame);
    const workerDurationMs = this.now() - startedAt;
    return {
      execution: "main-thread",
      payload,
      queueDurationMs: 0,
      resultTransferDurationMs: 0,
      totalDurationMs: workerDurationMs,
      workerDurationMs,
    };
  }
}

export function createDefaultSparkFramePacker(
  maximumWorkers: number,
  now: () => number,
): SparkFramePacker {
  return typeof globalThis.Worker === "function"
    ? new SparkFramePackingPool({ maximumWorkers, now })
    : new SynchronousSparkFramePacker(now);
}

function decodedFrameTransferList(frame: DecodedGaussianFrame): Transferable[] {
  const buffers = [
    frame.positions.buffer,
    frame.scales.buffer,
    frame.rotations.buffer,
    frame.alphas.buffer,
    frame.colors.buffer,
    frame.sphericalHarmonics.buffer,
  ];
  return [...new Set(buffers)].filter(
    (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
  );
}

function createBrowserPackingWorker(): SparkPackingWorkerLike {
  return new Worker(new URL("./sparkFramePacking.worker.js", import.meta.url), {
    name: "spark-gaussian-frame-packer",
    type: "module",
  });
}

function abortError(): DOMException {
  return new DOMException("Spark frame packing was aborted.", "AbortError");
}
