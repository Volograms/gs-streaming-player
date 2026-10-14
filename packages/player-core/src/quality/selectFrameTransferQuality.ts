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
  // This is queried for every frame in the rolling cache plan. Select directly
  // without allocating/cloning/sorting the whole tier ladder on each query.
  const qualities = source.qualityLevels ?? [];
  let floor: number | undefined;
  for (const quality of qualities) {
    if (quality === undefined) continue;
    const detail = qualityDetailLevel(quality);
    if (detail !== undefined && quality.minimumPlayable === true) {
      floor = Math.min(floor ?? detail, detail);
    }
  }
  const effectiveTarget = Math.max(requestedDetailLevel, floor ?? 0);
  let selected: GaussianQualityLevel | undefined;
  let selectedDetail = Infinity;
  let highest: GaussianQualityLevel | undefined;
  let highestDetail = -Infinity;
  for (const quality of qualities) {
    if (quality === undefined) continue;
    const detail = qualityDetailLevel(quality);
    if (detail === undefined) continue;
    if (
      highest === undefined ||
      detail > highestDetail ||
      (detail === highestDetail && quality.level >= highest.level)
    ) {
      highest = quality;
      highestDetail = detail;
    }
    if (
      detail >= effectiveTarget &&
      (selected === undefined ||
        detail < selectedDetail ||
        (detail === selectedDetail && quality.level < selected.level))
    ) {
      selected = quality;
      selectedDetail = detail;
    }
  }
  if (selected === undefined) {
    selected = highest;
    selectedDetail = highestDetail;
  }
  if (selected === undefined) return undefined;

  return {
    quality: {
      ...(selected.codec === undefined && source.codec === undefined
        ? {}
        : { codec: selected.codec ?? source.codec }),
      detailLevel: selectedDetail,
      level: selected.level,
      mode: "fixed",
      ...(selected.splatCount === undefined ? {} : { splatCount: selected.splatCount }),
    },
    source: {
      ...source,
      ...(selected.codec === undefined ? {} : { codec: selected.codec }),
      ...(selected.byteSize === undefined ? {} : { byteSize: selected.byteSize }),
      url: selected.url!,
    },
  };
}

export interface QualityCandidate {
  detailLevel: number;
  quality: GaussianQualityLevel & { url: string };
}

export function frameTransferQualityCandidates(
  source: GaussianFrameSource,
): QualityCandidate[] {
  return (source.qualityLevels ?? [])
    .map((quality) => toCandidate(quality))
    .filter((candidate): candidate is QualityCandidate => candidate !== undefined)
    .sort(
      (left, right) =>
        left.detailLevel - right.detailLevel ||
        left.quality.level - right.quality.level,
    );
}

function toCandidate(quality: GaussianQualityLevel): QualityCandidate | undefined {
  const detailLevel = qualityDetailLevel(quality);
  if (detailLevel === undefined) return undefined;
  return {
    detailLevel,
    quality: { ...quality, url: quality.url! },
  };
}

function qualityDetailLevel(quality: GaussianQualityLevel): number | undefined {
  if (quality.url === undefined) return undefined;
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
  return detailLevel;
}

function readMetadataRatio(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}
