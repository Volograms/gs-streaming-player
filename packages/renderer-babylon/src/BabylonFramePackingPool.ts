import { packDecodedGaussianFrameForBabylon } from "./babylonPackedFrame.js";
import { packDecodedGaussianFrameForBabylonNativeTextures } from "./babylonPackedFrame.js";
import { packSpzV4ForBabylonNativeTextures } from "./babylonSpzNativeFrame.js";

import type {
  BabylonFramePackingRequest,
  BabylonFramePackingResponse,
} from "./babylonFramePacking.protocol.js";
import type {
  BabylonNativeTexturePayload,
  BabylonPackedFramePayload,
  BabylonTextureSize,
} from "./babylonPackedFrame.js";
import type { BabylonSpzTextureConstraints } from "./babylonSpzNativeFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";
import type { GaussianCoordinateSystem } from "@6g-path/gaussian-codec";
import type { SpzStreamingDiagnostics } from "@6g-path/gaussian-codec-spz";

export interface BabylonFramePackingResult {
  execution: "main-thread" | "worker";
  payload: BabylonPackedFramePayload | BabylonNativeTexturePayload;
  queueDurationMs: number;
  resultTransferDurationMs: number;
  spzDiagnostics?: SpzStreamingDiagnostics;
  outputAllocatedBytes?: number;
  temporaryAllocatedBytes?: number;
  totalDurationMs: number;
  workerDurationMs: number;
}

export interface BabylonFramePacker {
  dispose?(): void;
  pack(
    frame: DecodedGaussianFrame,
    signal?: AbortSignal,
    nativeTextureSize?: BabylonTextureSize,
  ): Promise<BabylonFramePackingResult>;
  packSpz?(
    compressedBytes: Readonly<Uint8Array>,
    coordinateSystem: GaussianCoordinateSystem,
    constraints: BabylonSpzTextureConstraints,
    signal?: AbortSignal,
  ): Promise<BabylonFramePackingResult>;
}

export interface BabylonPackingWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<BabylonFramePackingResponse>) => void) | null;
  postMessage(message: BabylonFramePackingRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface PackingJob {
  compressedBytes?: Readonly<Uint8Array>;
  constraints?: BabylonSpzTextureConstraints;
  coordinateSystem?: GaussianCoordinateSystem;
  frame?: DecodedGaussianFrame;
  id: number;
  queuedAt: number;
  reject(error: unknown): void;
  resolve(result: BabylonFramePackingResult): void;
  signal?: AbortSignal;
  startedAt?: number;
  nativeTextureSize?: BabylonTextureSize;
}

interface WorkerSlot {
  job?: PackingJob;
  worker: BabylonPackingWorkerLike;
}

export interface BabylonFramePackingPoolOptions {
  maximumWorkers?: number;
  now?: () => number;
  workerFactory?: () => BabylonPackingWorkerLike;
}

export class BabylonFramePackingPool implements BabylonFramePacker {
  private disposed = false;
  private nextJobId = 1;
  private readonly now: () => number;
  private readonly queue: PackingJob[] = [];
  private readonly slots: WorkerSlot[];
  private readonly workerFactory: () => BabylonPackingWorkerLike;

  constructor(options: BabylonFramePackingPoolOptions = {}) {
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
    signal?: AbortSignal,
    nativeTextureSize?: BabylonTextureSize,
  ): Promise<BabylonFramePackingResult> {
    return this.enqueue(
      { frame, ...(nativeTextureSize === undefined ? {} : { nativeTextureSize }) },
      signal,
    );
  }

  packSpz(
    compressedBytes: Readonly<Uint8Array>,
    coordinateSystem: GaussianCoordinateSystem,
    constraints: BabylonSpzTextureConstraints,
    signal?: AbortSignal,
  ): Promise<BabylonFramePackingResult> {
    return this.enqueue({ compressedBytes, constraints, coordinateSystem }, signal);
  }

  private enqueue(
    input: Partial<
      Pick<
        PackingJob,
        | "compressedBytes"
        | "constraints"
        | "coordinateSystem"
        | "frame"
        | "nativeTextureSize"
      >
    >,
    signal?: AbortSignal,
  ): Promise<BabylonFramePackingResult> {
    if (this.disposed) {
      return Promise.reject(new Error("The Babylon frame packing pool was disposed."));
    }
    if (signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    return new Promise<BabylonFramePackingResult>((resolve, reject) => {
      const job: PackingJob = {
        ...input,
        id: this.nextJobId,
        queuedAt: this.now(),
        reject,
        resolve,
        ...(signal === undefined ? {} : { signal }),
      };
      this.nextJobId += 1;
      const abort = () => this.abortJob(job);
      signal?.addEventListener("abort", abort, { once: true });
      const originalResolve = job.resolve;
      const originalReject = job.reject;
      job.resolve = (result) => {
        signal?.removeEventListener("abort", abort);
        originalResolve(result);
      };
      job.reject = (error) => {
        signal?.removeEventListener("abort", abort);
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
      job.reject(new Error("The Babylon frame packing pool was disposed."));
    }
    for (const slot of this.slots) {
      slot.job?.reject(new Error("The Babylon frame packing pool was disposed."));
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
    worker: BabylonPackingWorkerLike,
  ): BabylonPackingWorkerLike {
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
          payload: "nativePayload" in data ? data.nativePayload : data.payload,
          queueDurationMs,
          ...("spzDiagnostics" in data && data.spzDiagnostics !== undefined
            ? { spzDiagnostics: data.spzDiagnostics }
            : {}),
          ...("outputAllocatedBytes" in data && data.outputAllocatedBytes !== undefined
            ? { outputAllocatedBytes: data.outputAllocatedBytes }
            : {}),
          ...("temporaryAllocatedBytes" in data &&
          data.temporaryAllocatedBytes !== undefined
            ? { temporaryAllocatedBytes: data.temporaryAllocatedBytes }
            : {}),
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
      job?.reject(new Error(event.message || "Babylon frame packing worker failed."));
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
        if (job.frame !== undefined) {
          slot.worker.postMessage(
            {
              frame: job.frame,
              id: job.id,
              ...(job.nativeTextureSize === undefined
                ? {}
                : { nativeTextureSize: job.nativeTextureSize }),
            },
            decodedFrameTransferList(job.frame),
          );
        } else if (
          job.compressedBytes !== undefined &&
          job.constraints !== undefined &&
          job.coordinateSystem !== undefined
        ) {
          const spzBytes = new Uint8Array(job.compressedBytes).slice().buffer;
          slot.worker.postMessage(
            {
              constraints: job.constraints,
              coordinateSystem: job.coordinateSystem,
              id: job.id,
              spzBytes,
            },
            [spzBytes],
          );
        } else {
          throw new Error("Babylon packing job has no valid input representation.");
        }
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

export class SynchronousBabylonFramePacker implements BabylonFramePacker {
  constructor(private readonly now: () => number = () => performance.now()) {}

  async pack(
    frame: DecodedGaussianFrame,
    signal?: AbortSignal,
    nativeTextureSize?: BabylonTextureSize,
  ): Promise<BabylonFramePackingResult> {
    if (signal?.aborted === true) {
      throw abortError();
    }
    const startedAt = this.now();
    const payload =
      nativeTextureSize === undefined
        ? packDecodedGaussianFrameForBabylon(frame)
        : packDecodedGaussianFrameForBabylonNativeTextures(frame, nativeTextureSize);
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

  async packSpz(
    compressedBytes: Readonly<Uint8Array>,
    coordinateSystem: GaussianCoordinateSystem,
    constraints: BabylonSpzTextureConstraints,
    signal?: AbortSignal,
  ): Promise<BabylonFramePackingResult> {
    if (signal?.aborted === true) {
      throw abortError();
    }
    const startedAt = this.now();
    const result = await packSpzV4ForBabylonNativeTextures(
      compressedBytes,
      coordinateSystem,
      constraints,
    );
    const workerDurationMs = this.now() - startedAt;
    return {
      execution: "main-thread",
      outputAllocatedBytes: result.outputAllocatedBytes,
      payload: result.payload,
      queueDurationMs: 0,
      resultTransferDurationMs: 0,
      spzDiagnostics: result.diagnostics,
      temporaryAllocatedBytes: result.temporaryAllocatedBytes,
      totalDurationMs: workerDurationMs,
      workerDurationMs,
    };
  }
}

export function createDefaultBabylonFramePacker(
  maximumWorkers: number,
  now: () => number,
): BabylonFramePacker {
  return typeof globalThis.Worker === "function"
    ? new BabylonFramePackingPool({ maximumWorkers, now })
    : new SynchronousBabylonFramePacker(now);
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

function createBrowserPackingWorker(): BabylonPackingWorkerLike {
  return new Worker(new URL("./babylonFramePacking.worker.js", import.meta.url), {
    name: "babylon-gaussian-frame-packer",
    type: "module",
  });
}

function abortError(): DOMException {
  return new DOMException("Babylon frame packing was aborted.", "AbortError");
}
