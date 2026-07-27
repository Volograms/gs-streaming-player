export interface GsplatRenderEnvironmentConfiguration {
  readonly foveationCenter?: string;
  readonly foveationStrength?: string;
  readonly minContribution?: string;
  readonly minPixelSize?: string;
}

export interface GsplatRenderConfiguration {
  readonly foveationCenter?: number;
  readonly foveationStrength?: number;
  readonly minContribution?: number;
  readonly minPixelSize?: number;
}

export function parseGsplatRenderConfiguration({
  foveationCenter,
  foveationStrength,
  minContribution,
  minPixelSize,
}: GsplatRenderEnvironmentConfiguration): GsplatRenderConfiguration {
  return {
    ...optionalNonNegativeNumber(
      minPixelSize,
      "VITE_PLAYCANVAS_GSPLAT_MIN_PIXEL_SIZE",
      "minPixelSize",
    ),
    ...optionalNonNegativeNumber(
      minContribution,
      "VITE_PLAYCANVAS_GSPLAT_MIN_CONTRIBUTION",
      "minContribution",
    ),
    ...optionalNonNegativeNumber(
      foveationStrength,
      "VITE_PLAYCANVAS_GSPLAT_FOVEATION_STRENGTH",
      "foveationStrength",
    ),
    ...optionalUnitNumber(
      foveationCenter,
      "VITE_PLAYCANVAS_GSPLAT_FOVEATION_CENTER",
      "foveationCenter",
    ),
  };
}

function optionalNonNegativeNumber(
  value: string | undefined,
  name: string,
  key: keyof GsplatRenderConfiguration,
): Partial<GsplatRenderConfiguration> {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
  return { [key]: parsed };
}

function optionalUnitNumber(
  value: string | undefined,
  name: string,
  key: keyof GsplatRenderConfiguration,
): Partial<GsplatRenderConfiguration> {
  const parsed = optionalNonNegativeNumber(value, name, key);
  const number = parsed[key];
  if (number !== undefined && number > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }
  return parsed;
}
