import { readSpzV4Header, SPZ_V4_CODEC_ID } from "./header.js";

import type { SpzDecodeRequest, SpzDecodeResponse } from "./protocol.js";
import type {
  DecodedGaussianFrame,
  GaussianFrameDecodeOptions,
  GaussianFrameDecoder,
} from "@6g-path/gaussian-codec";

interface WorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<SpzDecodeResponse>) => void) | null;
  postMessage(message: SpzDecodeRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface DecodeJob {
  bytes: Readonly<Uint8Array>;
  coordinateSystem: NonNullable<GaussianFrameDecodeOptions["coordinateSystem"]>;
  id: number;
  onTrace?: GaussianFrameDecodeOptions["onTrace"];
  reject(error: unknown): void;
  resolve(frame: DecodedGaussianFrame): void;
  signal?: AbortSignal;
  startedAt?: number;
}

interface WorkerSlot {
  job?: DecodeJob;
  worker: WorkerLike;
}

export interface SpzV4DecoderOptions {
  maximumWorkers?: number;
  workerFactory?: () => WorkerLike;
}

export class SpzV4Decoder implements GaussianFrameDecoder {
  readonly codecId = SPZ_V4_CODEC_ID;
  private disposed = false;
  private nextJobId = 1;
  private readonly queue: DecodeJob[] = [];
  private readonly slots: WorkerSlot[];
  private readonly workerFactory: () => WorkerLike;

  constructor(options: SpzV4DecoderOptions = {}) {
    const maximumWorkers = options.maximumWorkers ?? 2;
    if (!Number.isInteger(maximumWorkers) || maximumWorkers <= 0) {
      throw new RangeError("maximumWorkers must be a positive integer.");
    }
    this.workerFactory = options.workerFactory ?? createBrowserWorker;
    this.slots = Array.from({ length: maximumWorkers }, () => this.createSlot());
  }

  decode(
    compressedBytes: Readonly<Uint8Array>,
    options: GaussianFrameDecodeOptions = {},
  ): Promise<DecodedGaussianFrame> {
    if (this.disposed) {
      return Promise.reject(new Error("The SPZ v4 decoder has been disposed."));
    }
    readSpzV4Header(compressedBytes);
    if (options.signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    return new Promise<DecodedGaussianFrame>((resolve, reject) => {
      const job: DecodeJob = {
        bytes: compressedBytes,
        coordinateSystem: options.coordinateSystem ?? "RUB",
        id: this.nextJobId,
        ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
        reject,
        resolve,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      this.nextJobId += 1;
      const abort = () => this.abortJob(job);
      options.signal?.addEventListener("abort", abort, { once: true });
      const originalResolve = job.resolve;
      const originalReject = job.reject;
      job.resolve = (frame) => {
        options.signal?.removeEventListener("abort", abort);
        originalResolve(frame);
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
      job.reject(new Error("The SPZ v4 decoder was disposed."));
    }
    for (const slot of this.slots) {
      slot.job?.reject(new Error("The SPZ v4 decoder was disposed."));
      slot.worker.terminate();
      delete slot.job;
    }
  }

  private abortJob(job: DecodeJob): void {
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

  private configureWorker(slot: WorkerSlot, worker: WorkerLike): WorkerLike {
    worker.onmessage = ({ data }) => {
      const job = slot.job;
      if (job === undefined || data.id !== job.id) {
        return;
      }
      delete slot.job;
      if (data.ok) {
        const completedAt = performance.now();
        const diagnostics = data.diagnostics;
        for (const [phase, durationMs, bytesProcessed] of [
          [
            "input-allocation",
            diagnostics.inputAllocationDurationMs,
            job.bytes.byteLength,
          ],
          ["input-copy", diagnostics.inputCopyDurationMs, job.bytes.byteLength],
          [
            "output-allocation",
            diagnostics.outputAllocationDurationMs,
            data.outputAllocatedBytes,
          ],
          ["wasm-decode", diagnostics.wasmDecodeDurationMs, job.bytes.byteLength],
          [
            "attribute-write",
            diagnostics.attributeWriteDurationMs,
            data.outputAllocatedBytes,
          ],
          [
            "result-transfer",
            Math.max(
              0,
              completedAt -
                (job.startedAt ?? completedAt) -
                diagnostics.totalDurationMs,
            ),
            data.outputAllocatedBytes,
          ],
        ] as const) {
          job.onTrace?.({
            ...(bytesProcessed === undefined ? {} : { bytesProcessed }),
            durationMs,
            phase,
          });
        }
        job.resolve(data.frame);
      } else {
        job.reject(new Error(data.error));
      }
      this.dispatch();
    };
    worker.onerror = (event) => {
      const job = slot.job;
      delete slot.job;
      job?.reject(new Error(event.message || "SPZ v4 decode worker failed."));
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
      let job = this.queue.shift();
      while (job?.signal?.aborted === true) {
        job.reject(abortError());
        job = this.queue.shift();
      }
      if (job === undefined) {
        return;
      }
      slot.job = job;
      job.startedAt = performance.now();
      const bytes = new Uint8Array(job.bytes).slice().buffer;
      try {
        slot.worker.postMessage(
          {
            bytes,
            coordinateSystem: job.coordinateSystem,
            id: job.id,
          },
          [bytes],
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

function createBrowserWorker(): WorkerLike {
  return new Worker(new URL("./spzDecoder.worker.js", import.meta.url), {
    name: "gaussian-spz-v4-decoder",
    type: "module",
  });
}

function abortError(): DOMException {
  return new DOMException("SPZ v4 decoding was aborted.", "AbortError");
}
