import type { Keyframe } from "@6g-path/cue-timeline";

/** The subset of `explainer-assets.json` (from `gs-content build-explainer`) the app uses. */
export interface ExplainerAssets {
  checkpoints: ExplainerCheckpoint[];
  /** Real gaussian counts during training, keyed by iteration. */
  trainingCounts: Keyframe[];
}

export interface ExplainerCheckpoint {
  iteration: number;
  splatCount: number;
  /** Absolute URL of the stage-frame SOG. */
  url: string;
}

export async function loadExplainerAssets(
  indexUrl: string,
  signal?: AbortSignal,
): Promise<ExplainerAssets> {
  const url = new URL(indexUrl, window.location.href);
  const response = await fetch(url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`Explainer assets unavailable (${response.status}): ${url.href}`);
  }
  return parseExplainerAssets((await response.json()) as unknown, url.href);
}

export function parseExplainerAssets(value: unknown, baseUrl: string): ExplainerAssets {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Explainer assets must be a version 1 explainer-assets.json.");
  }
  if (!Array.isArray(value.checkpoints) || value.checkpoints.length === 0) {
    throw new Error("Explainer assets list no checkpoints.");
  }
  const checkpoints = value.checkpoints.map((entry, index): ExplainerCheckpoint => {
    if (
      !isRecord(entry) ||
      typeof entry.url !== "string" ||
      !isCount(entry.iteration) ||
      !isCount(entry.splatCount)
    ) {
      throw new Error(`Explainer checkpoint ${index} is malformed.`);
    }
    return {
      iteration: entry.iteration,
      splatCount: entry.splatCount,
      url: new URL(entry.url, baseUrl).href,
    };
  });
  checkpoints.sort((left, right) => left.iteration - right.iteration);
  const counts = Array.isArray(value.trainingCounts) ? value.trainingCounts : [];
  const trainingCounts = counts.map((entry, index): Keyframe => {
    if (!isRecord(entry) || !isCount(entry.iteration) || !isCount(entry.splatCount)) {
      throw new Error(`Explainer training count ${index} is malformed.`);
    }
    return { at: entry.iteration, value: entry.splatCount };
  });
  if (trainingCounts.length === 0) {
    throw new Error("Explainer assets have no training counts.");
  }
  return { checkpoints, trainingCounts };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
