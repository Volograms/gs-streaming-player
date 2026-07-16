import type { GaussianQualityLevel } from "@6g-path/gaussian-player";

export interface DynamicTransferQualityControlsProps {
  adaptive: boolean;
  disabled: boolean;
  levels: readonly GaussianQualityLevel[];
  onChange(detailLevel: number): void;
  presentedLevel?: number;
  selectedDetailLevel: number;
}

export function DynamicTransferQualityControls({
  adaptive,
  disabled,
  levels,
  onChange,
  presentedLevel,
  selectedDetailLevel,
}: DynamicTransferQualityControlsProps) {
  const selectedLevel = findLevelByDetail(levels, selectedDetailLevel) ?? levels.at(-1);
  const presented = levels.find(({ level }) => level === presentedLevel);

  return (
    <fieldset
      className="dynamic-transfer-controls"
      data-presented-level={presentedLevel}
      data-selected-detail={selectedLevel?.detailLevel ?? selectedDetailLevel}
      disabled={disabled}
    >
      <legend>Dynamic transfer</legend>
      <label htmlFor="dynamic-transfer-tier">
        SPZ quality tier
        <select
          disabled={adaptive}
          id="dynamic-transfer-tier"
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          value={selectedLevel?.detailLevel ?? selectedDetailLevel}
        >
          {levels.map((level) => (
            <option key={level.level} value={level.detailLevel}>
              {formatLevel(level)}
            </option>
          ))}
        </select>
      </label>
      <output aria-live="polite" htmlFor="dynamic-transfer-tier">
        {adaptive
          ? `Automatic · presented ${presented === undefined ? "pending" : formatLevel(presented)}`
          : `Selected ${selectedLevel === undefined ? "pending" : formatLevel(selectedLevel)} · presented ${
              presented === undefined ? "pending" : formatLevel(presented)
            }`}
      </output>
    </fieldset>
  );
}

function findLevelByDetail(
  levels: readonly GaussianQualityLevel[],
  detailLevel: number,
): GaussianQualityLevel | undefined {
  return (
    levels.find(({ detailLevel: candidate }) => candidate === detailLevel) ??
    levels.find(({ detailLevel: candidate }) => (candidate ?? 0) >= detailLevel)
  );
}

function formatLevel(level: GaussianQualityLevel): string {
  const tier = level.metadata?.tier;
  const name =
    typeof tier === "string" && tier.length > 0
      ? `${tier[0]?.toUpperCase() ?? ""}${tier.slice(1)}`
      : `Level ${level.level}`;
  const detail =
    level.detailLevel === undefined ? "" : ` · ${Math.round(level.detailLevel * 100)}%`;
  const splats =
    level.splatCount === undefined
      ? ""
      : ` · ${level.splatCount.toLocaleString()} splats`;
  return `${name}${detail}${splats}`;
}
