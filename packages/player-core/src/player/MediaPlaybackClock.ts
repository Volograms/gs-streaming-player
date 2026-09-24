import type { GaussianStreamingMediaElement } from "./GaussianStreamingPlayer.js";
import type { PlaybackClock } from "./SequencePlaybackController.js";

interface ScheduledCallback {
  callback: () => void;
  deadlineMs: number;
  handle?: unknown;
}

/** Keeps scheduler time continuous when the media position seeks, loops, or stalls. */
export class MediaPlaybackClock implements PlaybackClock {
  private clockAnchorMs = 0;
  private wallAnchorMs: number;
  private mediaAnchorSeconds = 0;
  private lastClockMs = 0;
  private usingMedia = false;
  private playing = false;
  private disposed = false;
  private revision = 0;
  private cancelPrime: (() => void) | undefined;
  private boundaryTimer: unknown;
  private lastTimelineSeconds = 0;
  private waitingValue = false;
  private mutedValue: boolean;
  private errorValue: unknown;
  private readonly timers = new Set<ScheduledCallback>();
  private readonly listeners: ReadonlyArray<readonly [string, () => void]>;
  onError: ((error: unknown) => void) | undefined;
  onChange: (() => void) | undefined;

  constructor(
    private readonly media: GaussianStreamingMediaElement,
    private readonly offsetSeconds: number,
    private readonly fallbackClock: PlaybackClock,
  ) {
    this.wallAnchorMs = fallbackClock.now();
    this.mutedValue = media.muted;
    media.preload = "auto";
    this.listeners = [
      [
        "ended",
        () => {
          this.useMedia(false);
          this.setWaiting(false);
        },
      ],
      [
        "waiting",
        () => {
          if (this.playing && this.usingMedia) this.setWaiting(true);
        },
      ],
      ["playing", () => this.setWaiting(false)],
      [
        "error",
        () => {
          const detail = this.media.error;
          this.fail(
            new Error(
              detail?.message ||
                `Audio playback failed${detail?.code === undefined ? "" : ` (media error ${detail.code})`}.`,
            ),
          );
        },
      ],
    ];
    for (const [type, listener] of this.listeners) {
      media.addEventListener(type, listener);
    }
  }

  get muted(): boolean {
    return this.mutedValue;
  }
  get volume(): number {
    return this.media.volume;
  }
  get waiting(): boolean {
    return this.waitingValue;
  }
  get error(): unknown {
    return this.errorValue;
  }

  now(): number {
    const elapsedMs = this.usingMedia
      ? (this.media.currentTime - this.mediaAnchorSeconds) * 1000
      : this.fallbackClock.now() - this.wallAnchorMs;
    this.lastClockMs = Math.max(this.lastClockMs, this.clockAnchorMs + elapsedMs);
    return this.lastClockMs;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const timer: ScheduledCallback = { callback, deadlineMs: this.now() + delayMs };
    if (!this.disposed) {
      this.timers.add(timer);
      this.armTimer(timer, Math.max(0, delayMs));
    }
    return timer;
  }

  clearTimeout(handle: unknown): void {
    const timer = handle as ScheduledCallback;
    if (this.timers.delete(timer)) this.fallbackClock.clearTimeout(timer.handle);
  }

  /** Called directly from the user's Play gesture, before waiting for splat frames. */
  async prime(timeSeconds: number): Promise<void> {
    this.stop();
    this.errorValue = undefined;
    const revision = this.revision;
    this.setMediaTime(timeSeconds - this.offsetSeconds);
    const cancelled = new Promise<boolean>((resolve) => {
      this.cancelPrime = () => resolve(false);
    });
    // Unlock the element from the gesture without sounding the track before its
    // offset/startup reserve, or while a replacement play request is pending.
    this.media.muted = true;
    try {
      const started = this.media.play().then(() => {
        if (revision !== this.revision) this.pauseIfUnwanted();
        return true;
      });
      if (!(await Promise.race([started, cancelled])) || revision !== this.revision)
        return;
      this.media.pause();
      this.setMediaTime(timeSeconds - this.offsetSeconds);
    } finally {
      if (revision === this.revision) {
        this.media.pause();
        this.cancelPrime = undefined;
        this.media.muted = this.mutedValue;
      }
    }
  }

  stop(): void {
    this.playing = false;
    this.revision += 1;
    this.cancelPrime?.();
    this.cancelPrime = undefined;
    this.clearBoundary();
    this.useMedia(false);
    this.media.pause();
    this.media.muted = this.mutedValue;
    this.setWaiting(false);
  }

  seek(timeSeconds: number): void {
    this.stop();
    this.lastTimelineSeconds = timeSeconds;
    this.setMediaTime(timeSeconds - this.offsetSeconds);
  }

  synchronise(timeSeconds: number, shouldPlay: boolean): void {
    if (this.disposed) return;
    const wrapped = timeSeconds + 1e-6 < this.lastTimelineSeconds;
    this.lastTimelineSeconds = timeSeconds;
    this.clearBoundary();
    if (!shouldPlay) {
      this.stop();
      this.setMediaTime(timeSeconds - this.offsetSeconds);
      return;
    }
    this.playing = true;
    const mediaTime = timeSeconds - this.offsetSeconds;
    if (mediaTime < 0) {
      this.useMedia(false);
      this.media.pause();
      this.setMediaTime(0);
      const boundaryClockMs = this.now();
      this.boundaryTimer = this.setTimeout(() => {
        this.boundaryTimer = undefined;
        if (this.playing) {
          this.synchronise(timeSeconds + (this.now() - boundaryClockMs) / 1000, true);
        }
      }, -mediaTime * 1000);
      return;
    }
    if (
      Number.isFinite(this.media.duration) &&
      mediaTime >= this.media.duration - 1e-7
    ) {
      this.useMedia(false);
      this.media.pause();
      this.setWaiting(false);
      return;
    }
    if (wrapped || !this.usingMedia) this.setMediaTime(mediaTime);
    if (this.usingMedia) return;
    // Hold scheduler time while play() waits for audio data, then follow its progress.
    this.useMedia(true);
    const revision = this.revision;
    try {
      void this.media.play().then(
        () => {
          if (revision !== this.revision) this.pauseIfUnwanted();
        },
        (error: unknown) => {
          if (revision === this.revision && !this.disposed) this.fail(error);
        },
      );
    } catch (error) {
      this.fail(error);
    }
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    if (this.cancelPrime === undefined) this.media.muted = muted;
  }
  setVolume(volume: number): void {
    this.media.volume = volume;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onChange = undefined;
    this.onError = undefined;
    this.stop();
    for (const timer of this.timers) this.clearTimeout(timer);
    for (const [type, listener] of this.listeners) {
      this.media.removeEventListener(type, listener);
    }
    if (this.media.removeAttribute !== undefined) {
      this.media.removeAttribute("src");
      this.media.load?.();
    } else {
      this.media.src = "";
    }
  }

  private useMedia(enabled: boolean): void {
    this.clockAnchorMs = this.now();
    this.wallAnchorMs = this.fallbackClock.now();
    this.mediaAnchorSeconds = this.media.currentTime;
    this.usingMedia = enabled;
  }

  private setMediaTime(timeSeconds: number): void {
    const time = Math.min(
      Math.max(0, timeSeconds),
      Number.isFinite(this.media.duration) ? this.media.duration : Infinity,
    );
    if (Math.abs(this.media.currentTime - time) < 1e-7) return;
    const clockMs = this.now();
    this.media.currentTime = time;
    this.clockAnchorMs = clockMs;
    this.mediaAnchorSeconds = this.media.currentTime;
    this.wallAnchorMs = this.fallbackClock.now();
  }

  private armTimer(timer: ScheduledCallback, delayMs: number): void {
    timer.handle = this.fallbackClock.setTimeout(() => {
      if (!this.timers.has(timer)) return;
      const remainingMs = timer.deadlineMs - this.now();
      // Native timers can fire while media time is frozen (startup or starvation).
      if (remainingMs > 1e-4) {
        this.armTimer(timer, Math.max(10, remainingMs));
      } else {
        this.timers.delete(timer);
        timer.callback();
      }
    }, delayMs);
  }

  private clearBoundary(): void {
    if (this.boundaryTimer !== undefined) {
      this.clearTimeout(this.boundaryTimer);
      this.boundaryTimer = undefined;
    }
  }

  private pauseIfUnwanted(): void {
    if (this.disposed || (!this.playing && this.cancelPrime === undefined))
      this.media.pause();
  }

  private setWaiting(waiting: boolean): void {
    if (waiting === this.waitingValue) return;
    this.waitingValue = waiting;
    this.onChange?.();
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    this.errorValue = error;
    this.stop();
    this.onError?.(error);
  }
}
