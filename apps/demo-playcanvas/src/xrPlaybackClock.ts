import type { PlaybackClock } from "@6g-path/gaussian-player";

interface ScheduledCallback {
  readonly callback: () => void;
  readonly deadlineMs: number;
  nativeHandle: number | undefined;
}

export class XrPlaybackClock implements PlaybackClock {
  private disposed = false;
  private nextHandle = 1;
  private readonly scheduled = new Map<number, ScheduledCallback>();
  private xrActive = false;

  clearTimeout(handle: unknown): void {
    const numericHandle = Number(handle);
    const scheduled = this.scheduled.get(numericHandle);
    if (scheduled?.nativeHandle !== undefined) {
      window.clearTimeout(scheduled.nativeHandle);
    }
    this.scheduled.delete(numericHandle);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const scheduled of this.scheduled.values()) {
      if (scheduled.nativeHandle !== undefined) {
        window.clearTimeout(scheduled.nativeHandle);
      }
    }
    this.scheduled.clear();
  }

  enterXr(): void {
    if (this.disposed || this.xrActive) {
      return;
    }
    this.xrActive = true;
    for (const scheduled of this.scheduled.values()) {
      if (scheduled.nativeHandle !== undefined) {
        window.clearTimeout(scheduled.nativeHandle);
        scheduled.nativeHandle = undefined;
      }
    }
  }

  exitXr(): void {
    if (this.disposed || !this.xrActive) {
      return;
    }
    this.xrActive = false;
    for (const [handle, scheduled] of this.scheduled) {
      this.scheduleNative(handle, scheduled);
    }
  }

  now(): number {
    return performance.now();
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    if (this.disposed) {
      return 0;
    }
    const handle = this.nextHandle++;
    const scheduled: ScheduledCallback = {
      callback,
      deadlineMs: this.now() + Math.max(0, delayMs),
      nativeHandle: undefined,
    };
    this.scheduled.set(handle, scheduled);
    if (!this.xrActive) {
      this.scheduleNative(handle, scheduled);
    }
    return handle;
  }

  tick(nowMs: number): void {
    if (this.disposed || !this.xrActive) {
      return;
    }
    const due = [...this.scheduled.entries()]
      .filter(([, scheduled]) => scheduled.deadlineMs <= nowMs)
      .sort((left, right) => left[1].deadlineMs - right[1].deadlineMs);
    for (const [handle, scheduled] of due) {
      if (!this.scheduled.delete(handle)) {
        continue;
      }
      scheduled.callback();
    }
  }

  private scheduleNative(handle: number, scheduled: ScheduledCallback): void {
    scheduled.nativeHandle = window.setTimeout(
      () => {
        if (!this.scheduled.delete(handle)) {
          return;
        }
        scheduled.callback();
      },
      Math.max(0, scheduled.deadlineMs - this.now()),
    );
  }
}
