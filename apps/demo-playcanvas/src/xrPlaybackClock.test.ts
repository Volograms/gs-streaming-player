import { afterEach, describe, expect, it, vi } from "vitest";

import { XrPlaybackClock } from "./xrPlaybackClock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("XrPlaybackClock", () => {
  it("migrates a pending window timer to XR frame ticks", () => {
    const nativeCallbacks = new Map<number, () => void>();
    let nextNativeHandle = 1;
    vi.stubGlobal("window", {
      clearTimeout: (handle: number) => nativeCallbacks.delete(handle),
      setTimeout: (callback: () => void) => {
        const handle = nextNativeHandle++;
        nativeCallbacks.set(handle, callback);
        return handle;
      },
    });
    const callback = vi.fn();
    const clock = new XrPlaybackClock();
    const deadline = clock.now() + 30;

    clock.setTimeout(callback, 30);
    expect(nativeCallbacks.size).toBe(1);

    clock.enterXr();
    expect(nativeCallbacks.size).toBe(0);
    clock.tick(deadline - 1);
    expect(callback).not.toHaveBeenCalled();
    clock.tick(deadline + 1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("moves pending XR deadlines back to window timers on exit", () => {
    const nativeCallbacks = new Map<number, () => void>();
    let nextNativeHandle = 1;
    vi.stubGlobal("window", {
      clearTimeout: (handle: number) => nativeCallbacks.delete(handle),
      setTimeout: (callback: () => void) => {
        const handle = nextNativeHandle++;
        nativeCallbacks.set(handle, callback);
        return handle;
      },
    });
    const callback = vi.fn();
    const clock = new XrPlaybackClock();

    clock.enterXr();
    clock.setTimeout(callback, 30);
    expect(nativeCallbacks.size).toBe(0);

    clock.exitXr();
    expect(nativeCallbacks.size).toBe(1);
    nativeCallbacks.values().next().value?.();
    expect(callback).toHaveBeenCalledOnce();
  });
});
