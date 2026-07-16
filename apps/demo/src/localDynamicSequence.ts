import { CAPTURE_TO_THREE_TRANSFORM } from "./sceneCoordinates.js";

import type {
  DynamicGaussianSequence,
  GaussianQualityLevel,
} from "@6g-path/gaussian-player";

const DEFAULT_FRAME_RATE = 30;
const DEFAULT_START_FRAME = 40;
const DEFAULT_END_FRAME = 50;

type Environment = Record<string, string | undefined>;

interface QualityCutFrame {
  qualityLevels: GaussianQualityLevel[];
  sourceFile: string;
}

interface QualityCutIndex {
  frames: QualityCutFrame[];
  format: string;
  version: number;
}

export interface LoadLocalDynamicSequenceOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

function readInteger(environment: Environment, name: string, fallback: number): number {
  const value = environment[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function readFrameRate(environment: Environment): number {
  const value = environment.VITE_DYNAMIC_RAD_FRAME_RATE;
  if (value === undefined) {
    return DEFAULT_FRAME_RATE;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("VITE_DYNAMIC_RAD_FRAME_RATE must be a positive number.");
  }
  return parsed;
}

export function createLocalDynamicSequence(
  environment: Environment,
): DynamicGaussianSequence | undefined {
  const configuredBaseUrl = environment.VITE_DYNAMIC_RAD_BASE_URL;
  if (configuredBaseUrl === undefined || configuredBaseUrl.trim() === "") {
    return undefined;
  }

  const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const startFrame = readInteger(
    environment,
    "VITE_DYNAMIC_RAD_START_FRAME",
    DEFAULT_START_FRAME,
  );
  const endFrame = readInteger(
    environment,
    "VITE_DYNAMIC_RAD_END_FRAME",
    DEFAULT_END_FRAME,
  );
  if (endFrame < startFrame) {
    throw new Error(
      "VITE_DYNAMIC_RAD_END_FRAME must be greater than or equal to VITE_DYNAMIC_RAD_START_FRAME.",
    );
  }

  const frameRate = readFrameRate(environment);
  const sourceFrameIndices = Array.from(
    { length: endFrame - startFrame + 1 },
    (_, index) => startFrame + index,
  );

  return {
    frameCount: sourceFrameIndices.length,
    frameRate,
    frames: sourceFrameIndices.map((sourceFrameIndex, frameIndex) => ({
      frameIndex,
      metadata: { sourceFrameIndex },
      timestampSeconds: frameIndex / frameRate,
      url: `${baseUrl}/frame${String(sourceFrameIndex).padStart(4, "0")}-lod.rad`,
    })),
    id: "local-dynamic-sequence",
    metadata: { sourceEndFrame: endFrame, sourceStartFrame: startFrame },
    transform: CAPTURE_TO_THREE_TRANSFORM,
  };
}

export function hasLocalDynamicSequenceConfiguration(
  environment: Environment,
): boolean {
  return [
    environment.VITE_DYNAMIC_RAD_BASE_URL,
    environment.VITE_DYNAMIC_QUALITY_INDEX_URL,
  ].some((value) => value !== undefined && value.trim() !== "");
}

export async function loadLocalDynamicSequence(
  environment: Environment,
  options: LoadLocalDynamicSequenceOptions = {},
): Promise<DynamicGaussianSequence | undefined> {
  const configuredIndexUrl = environment.VITE_DYNAMIC_QUALITY_INDEX_URL;
  if (configuredIndexUrl === undefined || configuredIndexUrl.trim() === "") {
    return createLocalDynamicSequence(environment);
  }

  const indexUrl = resolveUrl(configuredIndexUrl, options.baseUrl);
  const response = await (options.fetch ?? globalThis.fetch)(
    indexUrl,
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  if (!response.ok) {
    throw new Error(
      `Dynamic quality index returned HTTP ${response.status}: ${indexUrl}`,
    );
  }
  const index = validateQualityCutIndex((await response.json()) as unknown);
  const framesBySourceIndex = new Map(
    index.frames.map((frame) => [readSourceFrameIndex(frame.sourceFile), frame]),
  );
  const startFrame = readInteger(
    environment,
    "VITE_DYNAMIC_RAD_START_FRAME",
    DEFAULT_START_FRAME,
  );
  const endFrame = readInteger(
    environment,
    "VITE_DYNAMIC_RAD_END_FRAME",
    DEFAULT_END_FRAME,
  );
  if (endFrame < startFrame) {
    throw new Error(
      "VITE_DYNAMIC_RAD_END_FRAME must be greater than or equal to VITE_DYNAMIC_RAD_START_FRAME.",
    );
  }
  const frameRate = readFrameRate(environment);
  const radBaseUrl = environment.VITE_DYNAMIC_RAD_BASE_URL?.replace(/\/+$/, "");
  const sourceFrameIndices = Array.from(
    { length: endFrame - startFrame + 1 },
    (_, offset) => startFrame + offset,
  );

  return {
    frameCount: sourceFrameIndices.length,
    frameRate,
    frames: sourceFrameIndices.map((sourceFrameIndex, frameIndex) => {
      const cutFrame = framesBySourceIndex.get(sourceFrameIndex);
      if (cutFrame === undefined) {
        throw new Error(
          `Dynamic quality index has no entry for source frame ${sourceFrameIndex}.`,
        );
      }
      const qualityLevels = cutFrame.qualityLevels.map((quality) =>
        normaliseQualityLevel(quality, indexUrl),
      );
      const fallbackUrl =
        radBaseUrl === undefined
          ? (qualityLevels.find(({ minimumPlayable }) => minimumPlayable)?.url ??
            qualityLevels[0]?.url)
          : `${radBaseUrl}/frame${String(sourceFrameIndex).padStart(4, "0")}-lod.rad`;
      if (fallbackUrl === undefined) {
        throw new Error(
          `Dynamic quality index frame ${sourceFrameIndex} has no usable asset URL.`,
        );
      }
      return {
        frameIndex,
        metadata: { sourceFrameIndex },
        qualityLevels,
        timestampSeconds: frameIndex / frameRate,
        url: fallbackUrl,
      };
    }),
    id: "local-dynamic-sequence",
    metadata: {
      qualityIndexUrl: indexUrl,
      sourceEndFrame: endFrame,
      sourceStartFrame: startFrame,
    },
    transform: CAPTURE_TO_THREE_TRANSFORM,
  };
}

function resolveUrl(value: string, baseUrl?: string): string {
  const fallbackBase =
    baseUrl ??
    (typeof globalThis.location === "undefined" ? undefined : globalThis.location.href);
  try {
    return new URL(value, fallbackBase).href;
  } catch {
    throw new Error(
      "VITE_DYNAMIC_QUALITY_INDEX_URL must be absolute when no document base URL is available.",
    );
  }
}

function validateQualityCutIndex(value: unknown): QualityCutIndex {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("format" in value) ||
    value.format !== "flat-spz-quality-cuts" ||
    !("frames" in value) ||
    !Array.isArray(value.frames)
  ) {
    throw new Error("Dynamic quality index is not a supported quality-cuts document.");
  }
  for (const frame of value.frames) {
    if (
      typeof frame !== "object" ||
      frame === null ||
      !("sourceFile" in frame) ||
      typeof frame.sourceFile !== "string" ||
      !("qualityLevels" in frame) ||
      !Array.isArray(frame.qualityLevels)
    ) {
      throw new Error("Dynamic quality index contains an invalid frame entry.");
    }
  }
  return value as QualityCutIndex;
}

function readSourceFrameIndex(sourceFile: string): number {
  const match = /frame(\d+)-lod\.rad$/i.exec(sourceFile);
  const sourceFrameIndex = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(sourceFrameIndex)) {
    throw new Error(`Cannot read a source frame number from '${sourceFile}'.`);
  }
  return sourceFrameIndex;
}

function readQualityRatio(
  quality: GaussianQualityLevel,
  key: string,
): number | undefined {
  const value = quality.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function normaliseQualityLevel(
  quality: GaussianQualityLevel,
  indexUrl: string,
): GaussianQualityLevel {
  const inferredDetailLevel =
    readQualityRatio(quality, "targetLeafRatio") ??
    readQualityRatio(quality, "actualLeafRatio");
  return {
    ...quality,
    ...(quality.detailLevel === undefined && inferredDetailLevel !== undefined
      ? { detailLevel: inferredDetailLevel }
      : {}),
    ...(quality.url === undefined ? {} : { url: new URL(quality.url, indexUrl).href }),
  };
}
