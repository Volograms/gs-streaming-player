import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToPlayerUi } from "./playerUiUpdates.js";

import type {
  GaussianStreamingPlayer,
  GaussianStreamingPlayerSnapshot,
} from "@6g-path/gaussian-player";

type Snapshot = GaussianStreamingPlayerSnapshot;
type Listener = Parameters<GaussianStreamingPlayer["subscribe"]>[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
});

afterEach(() => vi.useRealTimers());

describe("subscribeToPlayerUi", () => {
  it("publishes the initial snapshot and the latest progress at 100 ms intervals", () => {
    const { emit, onSnapshot } = harness();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot());

    for (let index = 1; index <= 9; index += 1) {
      vi.advanceTimersByTime(10);
      emit(snapshot({ currentTimeSeconds: index, decodedFrameCount: index }));
    }
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenLastCalledWith(
      snapshot({ currentTimeSeconds: 9, decodedFrameCount: 9 }),
    );

    vi.advanceTimersByTime(5);
    emit(snapshot({ currentTimeSeconds: 10 }));
    vi.advanceTimersByTime(94);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(onSnapshot).toHaveBeenCalledTimes(3);
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot({ currentTimeSeconds: 10 }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes immediately after an idle interval", () => {
    const { emit, onSnapshot } = harness();
    vi.advanceTimersByTime(150);
    emit(snapshot({ currentTimeSeconds: 1 }));
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  const controlChanges: [string, Partial<Snapshot>][] = [
    ["lifecycle", { lifecycle: "BUFFERING" }],
    ["playing", { isPlaying: false }],
    ["error", { error: new Error("Playback failed") }],
    ["quality mode", { qualityMode: { mode: "automatic" } }],
    ["manual detail", { qualityMode: { mode: "manual", detailLevel: 1 } }],
    [
      "manual minimum splats",
      { qualityMode: { mode: "manual", detailLevel: 0.5, minimumSplatCount: 100 } },
    ],
    ["audio mute", { audio: { configured: true, muted: true, volume: 1 } }],
    ["audio volume", { audio: { configured: true, muted: false, volume: 0.5 } }],
  ];

  it.each(controlChanges)(
    "publishes %s changes immediately and replaces stale pending progress",
    (_, change) => {
      const { emit, onSnapshot } = harness();
      vi.advanceTimersByTime(20);
      emit(snapshot({ currentTimeSeconds: 1 }));
      vi.advanceTimersByTime(20);
      const changed = snapshot({ currentTimeSeconds: 2, ...change });
      emit(changed);
      expect(onSnapshot).toHaveBeenCalledTimes(2);
      expect(onSnapshot).toHaveBeenLastCalledWith(changed);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(10);
      const latest = snapshot({ currentTimeSeconds: 3, ...change });
      emit(latest);
      vi.advanceTimersByTime(89);
      expect(onSnapshot).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(onSnapshot).toHaveBeenCalledTimes(3);
      expect(onSnapshot).toHaveBeenLastCalledWith(latest);
    },
  );

  it("cancels trailing updates and ignores callbacks after unsubscribe", () => {
    const { cleanup, emit, onSnapshot, unsubscribe } = harness();
    emit(snapshot({ currentTimeSeconds: 1 }));
    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    emit(snapshot({ lifecycle: "CLOSED" }));
    vi.advanceTimersByTime(200);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });
});

function harness() {
  let listener: Listener | undefined;
  const unsubscribe = vi.fn();
  const player: Pick<GaussianStreamingPlayer, "subscribe"> = {
    subscribe(nextListener) {
      listener = nextListener;
      listener(snapshot());
      return unsubscribe;
    },
  };
  const onSnapshot = vi.fn();
  const cleanup = subscribeToPlayerUi(player, onSnapshot);
  return {
    cleanup,
    emit: (next: Snapshot) => listener?.(next),
    onSnapshot,
    unsubscribe,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    audio: { configured: true, muted: false, volume: 1 },
    bufferAheadFrames: 0,
    bufferedTimeRanges: [],
    decodedTimeRanges: [],
    decodedFrameCount: 0,
    currentFrameIndex: 0,
    currentTimeSeconds: 0,
    droppedFrameCount: 0,
    durationSeconds: 100,
    isPlaying: true,
    lifecycle: "PLAYING",
    manifestId: "scene",
    qualityMode: { mode: "manual", detailLevel: 0.5 },
    renderer: {
      failedResourceLoadCount: 0,
      loadedMeshObjectCount: 0,
      loadedStaticObjectCount: 0,
      loadingResourceCount: 0,
      preparedFrameCount: 0,
      resources: [],
    },
    sequenceId: "actor",
    ...overrides,
  };
}
