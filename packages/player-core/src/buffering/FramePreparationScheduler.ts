import type { PreparedFrame } from "../renderer/types.js";

export interface FramePreparationPriority {
  deadlineMs: number;
  estimatedBytes: number;
  frameIndex: number;
  temporalDistance: number;
}

interface QueuedPreparation {
  describe(): FramePreparationPriority;
  reject(reason: unknown): void;
  resolve(frame: PreparedFrame): void;
  run(): Promise<PreparedFrame>;
  sequence: number;
  signal: AbortSignal;
}

function abortError(): Error {
  const error = new Error("Frame preparation was cancelled before it started.");
  error.name = "AbortError";
  return error;
}

/** Bounds renderer preparation work while retaining deadline-aware queue ordering. */
export class FramePreparationScheduler {
  private activeCountValue = 0;
  private maximumConcurrencyValue: number;
  private readonly queue: QueuedPreparation[] = [];
  private sequence = 0;

  constructor(maximumConcurrency: number) {
    this.assertMaximumConcurrency(maximumConcurrency);
    this.maximumConcurrencyValue = maximumConcurrency;
  }

  get activeCount(): number {
    return this.activeCountValue;
  }

  get maximumConcurrency(): number {
    return this.maximumConcurrencyValue;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  enqueue(
    describe: () => FramePreparationPriority,
    signal: AbortSignal,
    run: () => Promise<PreparedFrame>,
  ): Promise<PreparedFrame> {
    if (signal.aborted) {
      return Promise.reject(abortError());
    }

    return new Promise<PreparedFrame>((resolve, reject) => {
      const request: QueuedPreparation = {
        describe,
        reject,
        resolve,
        run,
        sequence: this.sequence,
        signal,
      };
      this.sequence += 1;
      const cancelQueuedRequest = () => {
        const index = this.queue.indexOf(request);
        if (index >= 0) {
          this.queue.splice(index, 1);
          reject(abortError());
        }
      };
      signal.addEventListener("abort", cancelQueuedRequest, { once: true });
      const originalResolve = request.resolve;
      const originalReject = request.reject;
      request.resolve = (frame) => {
        signal.removeEventListener("abort", cancelQueuedRequest);
        originalResolve(frame);
      };
      request.reject = (reason) => {
        signal.removeEventListener("abort", cancelQueuedRequest);
        originalReject(reason);
      };
      this.queue.push(request);
      this.drain();
    });
  }

  reprioritise(): void {
    this.drain();
  }

  setMaximumConcurrency(maximumConcurrency: number): void {
    this.assertMaximumConcurrency(maximumConcurrency);
    this.maximumConcurrencyValue = maximumConcurrency;
    this.drain();
  }

  private assertMaximumConcurrency(maximumConcurrency: number): void {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency <= 0) {
      throw new RangeError("maximumConcurrency must be a positive integer.");
    }
  }

  private compare(a: QueuedPreparation, b: QueuedPreparation): number {
    const left = a.describe();
    const right = b.describe();
    return (
      left.temporalDistance - right.temporalDistance ||
      left.deadlineMs - right.deadlineMs ||
      left.estimatedBytes - right.estimatedBytes ||
      a.sequence - b.sequence
    );
  }

  private drain(): void {
    while (
      this.activeCountValue < this.maximumConcurrencyValue &&
      this.queue.length > 0
    ) {
      this.queue.sort((a, b) => this.compare(a, b));
      const request = this.queue.shift();
      if (request === undefined) {
        return;
      }
      if (request.signal.aborted) {
        request.reject(abortError());
        continue;
      }
      this.activeCountValue += 1;
      void request
        .run()
        .then(request.resolve, request.reject)
        .finally(() => {
          this.activeCountValue -= 1;
          this.drain();
        });
    }
  }
}
