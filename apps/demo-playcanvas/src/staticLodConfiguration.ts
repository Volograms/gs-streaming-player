export interface StaticLodEnvironmentConfiguration {
  readonly lodLevel?: string;
  readonly splatBudget?: string;
}

export interface StaticLodConfiguration {
  readonly lodLevel?: number;
  readonly splatBudget?: number;
}

export function parseStaticLodConfiguration({
  lodLevel,
  splatBudget,
}: StaticLodEnvironmentConfiguration): StaticLodConfiguration {
  const parsedLodLevel = optionalNonNegativeInteger(
    lodLevel,
    "VITE_STATIC_GS_LOD_LEVEL",
  );
  const parsedSplatBudget = optionalNonNegativeInteger(
    splatBudget,
    "VITE_PLAYCANVAS_SPLAT_BUDGET",
  );
  return {
    ...(parsedLodLevel === undefined ? {} : { lodLevel: parsedLodLevel }),
    ...(parsedSplatBudget === undefined ? {} : { splatBudget: parsedSplatBudget }),
  };
}

function optionalNonNegativeInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}
