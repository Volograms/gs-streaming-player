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
  const floor = Math.max(
    0,
    common.findIndex(({ minimumPlayable }) => minimumPlayable),
  );
  return common.slice(floor).map(({ bytes, byteCount, count, detailLevel }) => ({
    detailLevel,
    ...(byteCount === count ? { estimatedFrameBytes: bytes / count } : {}),
  }));
}
