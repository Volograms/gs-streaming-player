import { framePlaybackStartSeconds } from "../manifest/timeline.js";

import type { FrameRingBufferSnapshot } from "./types.js";
import type { DynamicGaussianSequence } from "../manifest/types.js";

export interface BufferedTimeRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** Merge downloaded and presentation-ready frames without filling download gaps. */
export function bufferedTimeRanges(
  snapshot: Readonly<FrameRingBufferSnapshot>,
  sequence: Readonly<DynamicGaussianSequence>,
  durationSeconds: number,
): readonly BufferedTimeRange[] {
  const indices = new Set(snapshot.compressedBuffer?.readyFrameIndices);
  for (const frame of snapshot.frames) {
    if (frame.status === "ready" || frame.status === "presented") {
      indices.add(frame.frameIndex);
    }
  }
  return frameTimeRanges(indices, sequence, durationSeconds);
}

/** Fully decoded frames that meet presentation quality, excluding cached bytes. */
export function decodedTimeRanges(
  snapshot: Readonly<FrameRingBufferSnapshot>,
  sequence: Readonly<DynamicGaussianSequence>,
  durationSeconds: number,
): readonly BufferedTimeRange[] {
  return frameTimeRanges(
    new Set(
      snapshot.frames
        .filter(({ status }) => status === "ready" || status === "presented")
        .map(({ frameIndex }) => frameIndex),
    ),
    sequence,
    durationSeconds,
  );
}

function frameTimeRanges(
  indices: ReadonlySet<number>,
  sequence: Readonly<DynamicGaussianSequence>,
  durationSeconds: number,
): readonly BufferedTimeRange[] {
  const ordered = [...indices].sort((a, b) => a - b);
  const ranges: BufferedTimeRange[] = [];
  let position = 0;
  while (position < ordered.length) {
    const first = ordered[position]!;
    let last = first;
    while (ordered[position + 1] === last + 1) {
      last = ordered[++position]!;
    }
    const startSeconds = framePlaybackStartSeconds(sequence, first);
    const endSeconds = Math.min(
      durationSeconds,
      sequence.frames[last + 1]?.timestampSeconds ?? durationSeconds,
    );
    if (endSeconds > startSeconds) ranges.push({ startSeconds, endSeconds });
    position += 1;
  }
  return ranges;
}
