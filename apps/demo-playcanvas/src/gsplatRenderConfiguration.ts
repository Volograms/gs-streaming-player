export interface GsplatRenderEnvironmentConfiguration {
  readonly alphaClipForward?: string;
  readonly foveationCenter?: string;
  readonly foveationStrength?: string;
  readonly gaussianSort?: string;
  readonly minContribution?: string;
  readonly minPixelSize?: string;
  readonly xrFixedFoveation?: string;
}

export interface GsplatRenderConfiguration {
  readonly alphaClipForward?: number;
  readonly foveationCenter?: number;
  readonly foveationStrength?: number;
  readonly gaussianSort?: "auto" | "cpu" | "gpu";
  readonly minContribution?: number;
  readonly minPixelSize?: number;
  readonly xrFixedFoveation?: number;
}

export function parseGsplatRenderConfiguration({
  alphaClipForward,
  foveationCenter,
  foveationStrength,
  gaussianSort,
  minContribution,
  minPixelSize,
  xrFixedFoveation,
}: GsplatRenderEnvironmentConfiguration): GsplatRenderConfiguration {
  return {
    ...optionalUnitNumber(
      alphaClipForward,
      "VITE_PLAYCANVAS_GSPLAT_ALPHA_CLIP_FORWARD",
      "alphaClipForward",
    ),
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
    ...optionalGaussianSort(gaussianSort),
    ...optionalUnitNumber(
      xrFixedFoveation,
      "VITE_PLAYCANVAS_XR_FIXED_FOVEATION",
      "xrFixedFoveation",
    ),
  };
}

function optionalGaussianSort(
  value: string | undefined,
): Partial<GsplatRenderConfiguration> {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const parsed = value.trim().toLowerCase();
  if (parsed !== "auto" && parsed !== "cpu" && parsed !== "gpu") {
    throw new Error("VITE_PLAYCANVAS_GSPLAT_SORT must be 'auto', 'cpu', or 'gpu'.");
  }
  return { gaussianSort: parsed };
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
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }
  return { [key]: parsed };
}
