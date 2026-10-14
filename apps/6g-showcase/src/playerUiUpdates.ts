import type {
  GaussianStreamingPlayer,
  GaussianStreamingPlayerSnapshot,
} from "@6g-path/gaussian-player";

const minimumUpdateIntervalMs = 100;
type Snapshot = Readonly<GaussianStreamingPlayerSnapshot>;

/** Coalesce frequent progress events while keeping transport controls responsive. */
export function subscribeToPlayerUi(
  player: Pick<GaussianStreamingPlayer, "subscribe">,
  onSnapshot: (snapshot: Snapshot) => void,
): () => void {
  let active = true;
  let published: Snapshot | undefined;
  let pending: Snapshot | undefined;
  let publishedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function publish(snapshot: Snapshot) {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    published = snapshot;
    publishedAt = performance.now();
    onSnapshot(snapshot);
  }

  const unsubscribe = player.subscribe((snapshot) => {
    if (!active) return;
    const elapsed = performance.now() - publishedAt;
    if (
      published === undefined ||
      controlsChanged(published, snapshot) ||
      elapsed >= minimumUpdateIntervalMs
    ) {
      publish(snapshot);
      return;
    }

    pending = snapshot;
    if (timer === undefined) {
      timer = setTimeout(
        () => {
          timer = undefined;
          if (active && pending !== undefined) publish(pending);
        },
        Math.ceil(minimumUpdateIntervalMs - elapsed),
      );
    }
  });

  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
}

function controlsChanged(previous: Snapshot, next: Snapshot): boolean {
  const previousQuality = previous.qualityMode;
  const nextQuality = next.qualityMode;
  return (
    previous.lifecycle !== next.lifecycle ||
    previous.isPlaying !== next.isPlaying ||
    !Object.is(previous.error, next.error) ||
    previousQuality.mode !== nextQuality.mode ||
    (previousQuality.mode === "manual" &&
      nextQuality.mode === "manual" &&
      (previousQuality.detailLevel !== nextQuality.detailLevel ||
        previousQuality.minimumSplatCount !== nextQuality.minimumSplatCount)) ||
    previous.audio.configured !== next.audio.configured ||
    previous.audio.muted !== next.audio.muted ||
    previous.audio.volume !== next.audio.volume
  );
}
