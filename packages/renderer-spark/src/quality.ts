import { SparkRendererStateError } from "./errors.js";

export type SparkMaximumSphericalHarmonics = 0 | 1 | 2 | 3;

export interface SparkFoveationConfiguration {
  behindScale: number;
  fullDetailFovDegrees: number;
  peripheralDetailFovDegrees: number;
  peripheralScale: number;
}

export interface SparkRenderQualityConfiguration {
  dynamicSequenceWeights: Readonly<Record<string, number>>;
  enableLod: boolean;
  foveation: SparkFoveationConfiguration;
  lodRenderScale: number;
  lodSplatScale: number;
  maximumSphericalHarmonics: SparkMaximumSphericalHarmonics;
  objectWeights: Readonly<Record<string, number>>;
  splatBudget?: number;
  staticSceneWeight: number;
}

export const DEFAULT_SPARK_RENDER_QUALITY: SparkRenderQualityConfiguration =
  Object.freeze({
    dynamicSequenceWeights: Object.freeze({}),
    enableLod: true,
    foveation: Object.freeze({
      behindScale: 0.2,
      fullDetailFovDegrees: 90,
      peripheralDetailFovDegrees: 120,
      peripheralScale: 0.4,
    }),
    lodRenderScale: 1,
    lodSplatScale: 1,
    maximumSphericalHarmonics: 3,
    objectWeights: Object.freeze({}),
    staticSceneWeight: 1,
  });

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SparkRendererStateError(`${name} must be a positive finite number.`);
  }
}

function validateWeights(
  name: string,
  weights: Readonly<Record<string, number>>,
): void {
  for (const [id, weight] of Object.entries(weights)) {
    if (id.length === 0) {
      throw new SparkRendererStateError(`${name} cannot contain an empty id.`);
    }
    assertPositive(`${name}[${JSON.stringify(id)}]`, weight);
  }
}

export function validateSparkRenderQuality(
  configuration: SparkRenderQualityConfiguration,
): void {
  if (
    configuration.splatBudget !== undefined &&
    (!Number.isInteger(configuration.splatBudget) || configuration.splatBudget <= 0)
  ) {
    throw new SparkRendererStateError("splatBudget must be a positive integer.");
  }
  assertPositive("lodSplatScale", configuration.lodSplatScale);
  assertPositive("lodRenderScale", configuration.lodRenderScale);
  assertPositive("staticSceneWeight", configuration.staticSceneWeight);
  validateWeights("objectWeights", configuration.objectWeights);
  validateWeights("dynamicSequenceWeights", configuration.dynamicSequenceWeights);

  const { foveation } = configuration;
  if (
    !Number.isFinite(foveation.fullDetailFovDegrees) ||
    foveation.fullDetailFovDegrees < 0 ||
    foveation.fullDetailFovDegrees > 180
  ) {
    throw new SparkRendererStateError(
      "foveation.fullDetailFovDegrees must be between 0 and 180.",
    );
  }
  if (
    !Number.isFinite(foveation.peripheralDetailFovDegrees) ||
    foveation.peripheralDetailFovDegrees < foveation.fullDetailFovDegrees ||
    foveation.peripheralDetailFovDegrees > 180
  ) {
    throw new SparkRendererStateError(
      "foveation.peripheralDetailFovDegrees must be between the full-detail FOV and 180.",
    );
  }
  for (const [name, value] of [
    ["behindScale", foveation.behindScale],
    ["peripheralScale", foveation.peripheralScale],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new SparkRendererStateError(
        `foveation.${name} must be above 0 and at most 1.`,
      );
    }
  }
  if (
    !Number.isInteger(configuration.maximumSphericalHarmonics) ||
    configuration.maximumSphericalHarmonics < 0 ||
    configuration.maximumSphericalHarmonics > 3
  ) {
    throw new SparkRendererStateError(
      "maximumSphericalHarmonics must be an integer from 0 through 3.",
    );
  }
}

export function cloneSparkRenderQuality(
  configuration: SparkRenderQualityConfiguration,
): SparkRenderQualityConfiguration {
  return {
    dynamicSequenceWeights: { ...configuration.dynamicSequenceWeights },
    enableLod: configuration.enableLod,
    foveation: { ...configuration.foveation },
    lodRenderScale: configuration.lodRenderScale,
    lodSplatScale: configuration.lodSplatScale,
    maximumSphericalHarmonics: configuration.maximumSphericalHarmonics,
    objectWeights: { ...configuration.objectWeights },
    ...(configuration.splatBudget === undefined
      ? {}
      : { splatBudget: configuration.splatBudget }),
    staticSceneWeight: configuration.staticSceneWeight,
  };
}
