import type {
  SparkMaximumSphericalHarmonics,
  SparkRenderQualityConfiguration,
} from "@6g-path/gaussian-renderer-spark";

export interface SparkQualityControlsProps {
  adaptive: boolean;
  configuration: SparkRenderQualityConfiguration;
  disabled: boolean;
  onAdaptiveChange(adaptive: boolean): void;
  onChange(configuration: SparkRenderQualityConfiguration): void;
}

function formatScale(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function SparkQualityControls({
  adaptive,
  configuration,
  disabled,
  onAdaptiveChange,
  onChange,
}: SparkQualityControlsProps) {
  const dynamicSequenceId =
    Object.keys(configuration.dynamicSequenceWeights)[0] ?? "actor";
  const dynamicWeight = configuration.dynamicSequenceWeights[dynamicSequenceId] ?? 1;

  return (
    <fieldset className="quality-controls" disabled={disabled}>
      <legend>Render quality</legend>

      <label className="quality-mode" htmlFor="adaptive-quality">
        Automatic buffer-aware quality
        <input
          checked={adaptive}
          id="adaptive-quality"
          onChange={(event) => onAdaptiveChange(event.currentTarget.checked)}
          type="checkbox"
        />
      </label>

      <label htmlFor="splat-budget">
        Splat budget
        <output htmlFor="splat-budget">
          {(configuration.splatBudget ?? 1_500_000).toLocaleString()}
        </output>
      </label>
      <input
        disabled={adaptive}
        id="splat-budget"
        type="range"
        min="100000"
        max="3000000"
        step="100000"
        value={configuration.splatBudget ?? 1_500_000}
        onChange={(event) =>
          onChange({
            ...configuration,
            splatBudget: Number(event.currentTarget.value),
          })
        }
      />

      <label htmlFor="static-detail">
        Static detail
        <output htmlFor="static-detail">
          {formatScale(configuration.staticSceneWeight)}
        </output>
      </label>
      <input
        disabled={adaptive}
        id="static-detail"
        type="range"
        min="0.25"
        max="2"
        step="0.05"
        value={configuration.staticSceneWeight}
        onChange={(event) =>
          onChange({
            ...configuration,
            staticSceneWeight: Number(event.currentTarget.value),
          })
        }
      />

      <label htmlFor="dynamic-detail">
        Dynamic render weight
        <output htmlFor="dynamic-detail">{formatScale(dynamicWeight)}</output>
      </label>
      <input
        disabled={adaptive}
        id="dynamic-detail"
        type="range"
        min="0.25"
        max="2"
        step="0.05"
        value={dynamicWeight}
        onChange={(event) =>
          onChange({
            ...configuration,
            dynamicSequenceWeights: {
              ...configuration.dynamicSequenceWeights,
              [dynamicSequenceId]: Number(event.currentTarget.value),
            },
          })
        }
      />

      <label htmlFor="peripheral-detail">
        Peripheral detail
        <output htmlFor="peripheral-detail">
          {formatScale(configuration.foveation.peripheralScale)}
        </output>
      </label>
      <input
        id="peripheral-detail"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={configuration.foveation.peripheralScale}
        onChange={(event) =>
          onChange({
            ...configuration,
            foveation: {
              ...configuration.foveation,
              peripheralScale: Number(event.currentTarget.value),
            },
          })
        }
      />

      <label htmlFor="maximum-sh">
        Maximum SH
        <select
          id="maximum-sh"
          value={configuration.maximumSphericalHarmonics}
          onChange={(event) =>
            onChange({
              ...configuration,
              maximumSphericalHarmonics: Number(
                event.currentTarget.value,
              ) as SparkMaximumSphericalHarmonics,
            })
          }
        >
          <option value="0">SH0</option>
          <option value="1">SH1</option>
          <option value="2">SH2</option>
          <option value="3">SH3</option>
        </select>
      </label>
    </fieldset>
  );
}
