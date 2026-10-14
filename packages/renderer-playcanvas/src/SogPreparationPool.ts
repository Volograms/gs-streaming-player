import { closeSogImages } from "./sog/sogPreparation.js";

import type { PreparedSogImages } from "./sog/sogPreparation.js";
import type {
  SogPreparationRequest,
  SogPreparationResponse,
} from "./sog/sogPreparation.protocol.js";

export class SogWorkerUnavailableError extends Error {}

export interface SogPreparationResult extends PreparedSogImages {
  queueDurationMs: number;
  workerDurationMs: number;
  roundTripDurationMs: number;
}

export interface SogWorkerLike {
  onmessage: ((event: MessageEvent<SogPreparationResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: SogPreparationRequest): void;
  terminate(): void;
}

interface Job {
  id: number;
  bytes: ArrayBuffer;
  queuedAt: number;
  startedAt: number;
  settled: boolean;
  resolve(result: SogPreparationResult): void;
  reject(error: unknown): void;
}

interface Slot {
  worker: SogWorkerLike;
  jobs: Map<number, Job>;
}

// ImageBitmap decode is asynchronous. One worker can keep several frames in
// flight without requiring one JavaScript thread per frame or starving the GPU.
const maximumJobsPerWorker = 4;

export class SogPreparationPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private failure: Error | undefined;
  private disposed = false;
  private readonly now: () => number;

  constructor(options: {
    maximumWorkers: number;
    now?: () => number;
    workerFactory?: () => SogWorkerLike;
  }) {
    if (!Number.isInteger(options.maximumWorkers) || options.maximumWorkers <= 0) {
      throw new RangeError("maximumWorkers must be a positive integer.");
    }
    this.now = options.now ?? (() => performance.now());
    try {
      for (let i = 0; i < options.maximumWorkers; i += 1) {
        const worker = (options.workerFactory ?? createWorker)();
        const slot: Slot = { worker, jobs: new Map() };
        this.slots.push(slot);
        worker.onmessage = ({ data }) => this.complete(slot, data);
        worker.onerror = (event) => {
          event.preventDefault();
          this.fail(
            new SogWorkerUnavailableError(event.message || "SOG worker failed."),
          );
        };
        worker.onmessageerror = () =>
          this.fail(
            new SogWorkerUnavailableError("Unable to receive SOG worker images."),
          );
      }
    } catch (error) {
      this.fail(
        new SogWorkerUnavailableError(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  get workerCount(): number {
    return this.failure === undefined && !this.disposed ? this.slots.length : 0;
  }

  prepare(bytes: ArrayBuffer, signal?: AbortSignal): Promise<SogPreparationResult> {
    if (this.disposed)
      return Promise.reject(new Error("SOG preparation pool is disposed."));
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const finish = () => {
        if (job.settled) return false;
        job.settled = true;
        signal?.removeEventListener("abort", abort);
        return true;
      };
      const job: Job = {
        id: this.nextId++,
        bytes,
        queuedAt: this.now(),
        startedAt: 0,
        settled: false,
        resolve: (result) => {
          if (finish()) resolve(result);
          else closeSogImages(result);
        },
        reject: (error) => {
          if (finish()) reject(error);
        },
      };
      const abort = () => {
        job.reject(
          signal?.reason ?? new DOMException("SOG preparation aborted.", "AbortError"),
        );
        const queued = this.queue.indexOf(job);
        if (queued >= 0) this.queue.splice(queued, 1);
        else {
          const slot = this.slots.find((candidate) => candidate.jobs.has(job.id));
          // Retain the occupied slot until decode finishes and closes its images.
          // This bounds work during rapid seeks despite non-cancellable image decode.
          try {
            slot?.worker.postMessage({ type: "cancel", id: job.id });
          } catch {
            this.fail(
              new SogWorkerUnavailableError("Unable to cancel SOG worker preparation."),
            );
          }
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new Error("SOG preparation pool is disposed."));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const slot of this.slots) {
      for (const job of slot.jobs.values()) job.reject(error);
      slot.jobs.clear();
      slot.worker.terminate();
    }
  }

  private complete(slot: Slot, response: SogPreparationResponse): void {
    const job = slot.jobs.get(response.id);
    if (job === undefined) {
      if (response.ok) closeSogImages(response.result);
      return;
    }
    slot.jobs.delete(job.id);
    if (response.ok) {
      job.resolve({
        ...response.result,
        queueDurationMs: job.startedAt - job.queuedAt,
        workerDurationMs: response.workerDurationMs,
        roundTripDurationMs: this.now() - job.startedAt,
      });
    } else {
      job.reject(
        response.unsupported
          ? new SogWorkerUnavailableError(response.error)
          : new Error(response.error),
      );
      if (response.unavailable)
        this.fail(new SogWorkerUnavailableError(response.error));
    }
    this.drain();
  }

  private drain(): void {
    while (!this.disposed && this.failure === undefined && this.queue.length > 0) {
      const slot = this.slots.reduce<Slot | undefined>(
        (least, candidate) =>
          least === undefined || candidate.jobs.size < least.jobs.size
            ? candidate
            : least,
        undefined,
      );
      if (slot === undefined || slot.jobs.size >= maximumJobsPerWorker) return;
      const job = this.queue.shift()!;
      slot.jobs.set(job.id, job);
      job.startedAt = this.now();
      try {
        // Structured clone preserves the byte cache's buffer. Copy only when a
        // worker has capacity, and transfer decoded ImageBitmaps back without copies.
        slot.worker.postMessage({ type: "prepare", id: job.id, bytes: job.bytes });
      } catch (error) {
        this.fail(
          new SogWorkerUnavailableError(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
  }
}

function createWorker(): SogWorkerLike {
  return new Worker(new URL("./sogPreparation.worker.js", import.meta.url), {
    type: "module",
    name: "sog-frame-preparation",
  });
}
