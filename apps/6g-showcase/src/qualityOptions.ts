import type { DynamicGaussianSequence } from "@6g-path/gaussian-player";

export interface ShowcaseQualityOption {
  detailLevel: number;
  label: string;
}

/** Returns the distinct transfer tiers advertised by a dynamic sequence. */
export function collectShowcaseQualityOptions(
  sequence: DynamicGaussianSequence,
): ShowcaseQualityOption[] {
  const tiers = new Map<
    string,
    {
      detailLevel: number;
      labelRatio: number;
      level: number;
      tier?: string;
    }
  >();

  for (const frame of sequence.frames) {
    for (const quality of frame.qualityLevels ?? []) {
      const detailLevel = quality.detailLevel;
      if (detailLevel === undefined) continue;
      const metadataTier = quality.metadata?.tier;
      const tier = typeof metadataTier === "string" ? metadataTier : undefined;
      const key = tier === undefined ? `level:${quality.level}` : `tier:${tier}`;
      const metadataTargetRatio = quality.metadata?.targetRatio;
      const labelRatio =
        typeof metadataTargetRatio === "number" &&
        Number.isFinite(metadataTargetRatio) &&
        metadataTargetRatio > 0 &&
        metadataTargetRatio <= 1
          ? metadataTargetRatio
          : detailLevel;
      const existing = tiers.get(key);
      if (existing === undefined) {
        tiers.set(key, {
          detailLevel,
          labelRatio,
          level: quality.level,
          ...(tier === undefined ? {} : { tier }),
        });
      } else {
        // Generated frames have slightly different measured ratios. The lowest
        // observed value still selects this authored tier for every frame.
        existing.detailLevel = Math.min(existing.detailLevel, detailLevel);
      }
    }
  }

  return [...tiers.values()]
    .sort(
      (left, right) => left.labelRatio - right.labelRatio || left.level - right.level,
    )
    .map(({ detailLevel, labelRatio, level, tier }) => ({
      detailLevel,
      label: `${tier === undefined ? `Quality ${level + 1}` : titleCase(tier)} · ${formatPercent(labelRatio)}`,
    }));
}

function formatPercent(detailLevel: number): string {
  const percentage = detailLevel * 100;
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;
}

function titleCase(value: string): string {
  return value
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
