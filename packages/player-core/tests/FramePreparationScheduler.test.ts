import { describe, expect, it, vi } from "vitest";

import { FramePreparationScheduler } from "../src/buffering/FramePreparationScheduler.js";

import type { PreparedFrame } from "../src/index.js";

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

function frame(frameIndex: number): PreparedFrame {
  return {
    frameIndex,
    qualityLevel: 0,
    rendererResource: {},
    sequenceId: "actor",
    source: {
      frameIndex,
      timestampSeconds: frameIndex / 30,
      url: `/frame-${frameIndex}.rad`,
    },
  };
}

describe("FramePreparationScheduler", () => {
  it("starts the nearest queued deadline when capacity becomes available", async () => {
    const scheduler = new FramePreparationScheduler(1);
    const blocker = deferred<PreparedFrame>();
    const order: number[] = [];
    const controller = new AbortController();
    const first = scheduler.enqueue(
      () => ({
        deadlineMs: 0,
        estimatedBytes: 100,
        frameIndex: 0,
        temporalDistance: 0,
      }),
      controller.signal,
      () => {
        order.push(0);
        return blocker.promise;
      },
    );
    const queued = [3, 1, 2].map((frameIndex) =>
      scheduler.enqueue(
        () => ({
          deadlineMs: frameIndex * 10,
          estimatedBytes: 100,
          frameIndex,
          temporalDistance: frameIndex,
        }),
        controller.signal,
        async () => {
          order.push(frameIndex);
          return frame(frameIndex);
        },
      ),
    );

    expect(order).toEqual([0]);
    expect(scheduler.queuedCount).toBe(3);
    blocker.resolve(frame(0));
    await first;
    await Promise.all(queued);

    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("supports runtime concurrency changes and queued cancellation", async () => {
    const scheduler = new FramePreparationScheduler(1);
    const first = deferred<PreparedFrame>();
    const second = deferred<PreparedFrame>();
    const starts = vi.fn();
    const activeController = new AbortController();
    const cancelledController = new AbortController();
    const active = scheduler.enqueue(
      () => ({
        deadlineMs: 0,
        estimatedBytes: 100,
        frameIndex: 0,
        temporalDistance: 0,
      }),
      activeController.signal,
      () => {
        starts(0);
        return first.promise;
      },
    );
    const secondActive = scheduler.enqueue(
      () => ({
        deadlineMs: 10,
        estimatedBytes: 100,
        frameIndex: 1,
        temporalDistance: 1,
      }),
      activeController.signal,
      () => {
        starts(1);
        return second.promise;
      },
    );
    const cancelled = scheduler.enqueue(
      () => ({
        deadlineMs: 20,
        estimatedBytes: 100,
        frameIndex: 2,
        temporalDistance: 2,
      }),
      cancelledController.signal,
      async () => {
        starts(2);
        return frame(2);
      },
    );
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });

    cancelledController.abort();
    scheduler.setMaximumConcurrency(2);
    expect(starts).toHaveBeenCalledWith(1);
    expect(scheduler.activeCount).toBe(2);
    first.resolve(frame(0));
    second.resolve(frame(1));

    await Promise.all([active, secondActive, cancelledAssertion]);
    expect(starts).not.toHaveBeenCalledWith(2);
  });
});
