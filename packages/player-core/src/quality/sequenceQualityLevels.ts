import { frameTransferQualityCandidates } from "./selectFrameTransferQuality.js";

import type { DynamicQualityLevel } from "./BufferAwareQualityController.js";
import type { DynamicGaussianSequence } from "../manifest/types.js";

/** Build the common authored ladder once, rather than estimating bytes from splat count. */
export function sequenceQualityLevels(
  sequence: DynamicGaussianSequence,
): DynamicQualityLevel[] {
  const levels = new Map<
    number,
    {
      bytes: number;
      byteCount: number;
      count: number;
      detailLevel: number;
      minimumPlayable: boolean;
    }
  >();
  for (const frame of sequence.frames) {
    for (const { detailLevel, quality } of frameTransferQualityCandidates(frame)) {
      const entry = levels.get(quality.level) ?? {
        bytes: 0,
        byteCount: 0,
        count: 0,
        detailLevel,
        minimumPlayable: false,
      };
      // Measured ratios can vary slightly between frames of the same authored tier.
      entry.detailLevel = Math.min(entry.detailLevel, detailLevel);
      entry.minimumPlayable ||= quality.minimumPlayable === true;
      entry.count += 1;
      const bytes =
        quality.byteSize ?? (quality.url === frame.url ? frame.byteSize : undefined);
      if (bytes !== undefined && bytes > 0) {
        entry.bytes += bytes;
        entry.byteCount += 1;
      }
      levels.set(quality.level, entry);
    }
  }
  const common = [...levels.values()]
    .filter(({ count }) => count === sequence.frameCount)
    .sort((left, right) => left.detailLevel - right.detailLevel);
  const distinct: Array<DynamicQualityLevel & { minimumPlayable: boolean }> = [];
  for (const { bytes, byteCount, count, detailLevel, minimumPlayable } of common) {
    const estimatedFrameBytes = byteCount === count ? bytes / count : undefined;
    const previous = distinct.at(-1);
    if (previous?.detailLevel === detailLevel) {
      // Equal ratios can belong to different authored IDs, including the playable
      // floor. Keep the most expensive estimate, or unknown if any tier is unmeasured.
      previous.minimumPlayable ||= minimumPlayable;
      if (
        previous.estimatedFrameBytes === undefined ||
        estimatedFrameBytes === undefined
      ) {
        delete previous.estimatedFrameBytes;
      } else {
        previous.estimatedFrameBytes = Math.max(
          previous.estimatedFrameBytes,
          estimatedFrameBytes,
        );
      }
    } else {
      distinct.push({
        detailLevel,
        minimumPlayable,
        ...(estimatedFrameBytes === undefined ? {} : { estimatedFrameBytes }),
      });
    }
  }
  const floor = Math.max(
    0,
    distinct.findIndex(({ minimumPlayable }) => minimumPlayable),
  );
  return distinct.slice(floor).map(({ detailLevel, estimatedFrameBytes }) => ({
    detailLevel,
    ...(estimatedFrameBytes === undefined ? {} : { estimatedFrameBytes }),
  }));
}
