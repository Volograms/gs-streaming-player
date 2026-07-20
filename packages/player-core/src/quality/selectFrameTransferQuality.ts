import type { GaussianFrameSource, GaussianQualityLevel } from "../manifest/types.js";
import type { FrameTransferQuality } from "../renderer/types.js";

export interface SelectedFrameTransfer {
  quality: FrameTransferQuality;
  source: GaussianFrameSource;
}

/**
 * Select the smallest independently addressable quality asset that satisfies the
 * requested detail. A tier marked minimumPlayable is treated as the presentation
 * floor even when policy asks for a lower detail.
 */
export function selectFrameTransferQuality(
  source: GaussianFrameSource,
  requestedDetailLevel: number,
): SelectedFrameTransfer | undefined {
  const candidates = (source.qualityLevels ?? [])
    .map((quality) => toCandidate(quality))
    .filter((candidate): candidate is QualityCandidate => candidate !== undefined)
    .sort(
      (left, right) =>
        left.detailLevel - right.detailLevel ||
        left.quality.level - right.quality.level,
    );
  if (candidates.length === 0) {
    return undefined;
  }

  const minimumPlayable = candidates.find(
    ({ quality }) => quality.minimumPlayable === true,
  );
  const effectiveTarget = Math.max(
    requestedDetailLevel,
    minimumPlayable?.detailLevel ?? 0,
  );
  const selected =
    candidates.find(({ detailLevel }) => detailLevel >= effectiveTarget) ??
    candidates.at(-1);
  if (selected === undefined) {
    return undefined;
  }

  return {
    quality: {
      ...(selected.quality.codec === undefined && source.codec === undefined
        ? {}
        : { codec: selected.quality.codec ?? source.codec }),
      detailLevel: selected.detailLevel,
      level: selected.quality.level,
      mode: "fixed",
      ...(selected.quality.splatCount === undefined
        ? {}
        : { splatCount: selected.quality.splatCount }),
    },
    source: {
      ...source,
      ...(selected.quality.codec === undefined
        ? {}
        : { codec: selected.quality.codec }),
      ...(selected.quality.byteSize === undefined
        ? {}
        : { byteSize: selected.quality.byteSize }),
      url: selected.quality.url,
    },
  };
}

interface QualityCandidate {
  detailLevel: number;
  quality: GaussianQualityLevel & { url: string };
}

function toCandidate(quality: GaussianQualityLevel): QualityCandidate | undefined {
  if (quality.url === undefined) {
    return undefined;
  }
  const detailLevel =
    quality.detailLevel ??
    readMetadataRatio(quality.metadata, "targetLeafRatio") ??
    readMetadataRatio(quality.metadata, "actualLeafRatio");
  if (
    detailLevel === undefined ||
    !Number.isFinite(detailLevel) ||
    detailLevel <= 0 ||
    detailLevel > 1
  ) {
    return undefined;
  }
  return {
    detailLevel,
    quality: { ...quality, url: quality.url },
  };
}

function readMetadataRatio(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}
