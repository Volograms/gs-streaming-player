export interface SceneScaleControlsProps {
  disabled: boolean;
  dynamicDisabled: boolean;
  dynamicScale: number;
  onDynamicScaleChange(scale: number): void;
  onStaticScaleChange(scale: number): void;
  staticDisabled: boolean;
  staticScale: number;
}

function formatScale(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function SceneScaleControls({
  disabled,
  dynamicDisabled,
  dynamicScale,
  onDynamicScaleChange,
  onStaticScaleChange,
  staticDisabled,
  staticScale,
}: SceneScaleControlsProps) {
  return (
    <fieldset className="scene-scale-controls" disabled={disabled}>
      <legend>Object scale</legend>

      <label htmlFor="static-object-scale">
        Static scene scale
        <output htmlFor="static-object-scale">{formatScale(staticScale)}</output>
      </label>
      <input
        disabled={staticDisabled}
        id="static-object-scale"
        type="range"
        min="0.25"
        max="4"
        step="0.05"
        value={staticScale}
        onChange={(event) => onStaticScaleChange(Number(event.currentTarget.value))}
      />

      <label htmlFor="dynamic-object-scale">
        Dynamic actor scale
        <output htmlFor="dynamic-object-scale">{formatScale(dynamicScale)}</output>
      </label>
      <input
        disabled={dynamicDisabled}
        id="dynamic-object-scale"
        type="range"
        min="0.25"
        max="4"
        step="0.05"
        value={dynamicScale}
        onChange={(event) => onDynamicScaleChange(Number(event.currentTarget.value))}
      />
    </fieldset>
  );
}
