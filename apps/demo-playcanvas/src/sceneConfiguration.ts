export type PlayCanvasDemoSceneMode =
  "dynamic-enabled" | "static-only" | "unconfigured";

export interface PlayCanvasDemoSceneConfiguration {
  dynamicQualityIndexUrl: string | undefined;
  staticGsUrl: string | undefined;
}

export function resolvePlayCanvasDemoSceneMode({
  dynamicQualityIndexUrl,
  staticGsUrl,
}: PlayCanvasDemoSceneConfiguration): PlayCanvasDemoSceneMode {
  if (dynamicQualityIndexUrl?.trim()) {
    return "dynamic-enabled";
  }
  if (staticGsUrl?.trim()) {
    return "static-only";
  }
  return "unconfigured";
}
