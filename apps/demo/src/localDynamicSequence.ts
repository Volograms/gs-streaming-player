import { CAPTURE_TO_THREE_TRANSFORM } from "./sceneCoordinates.js";

import type { DynamicGaussianSequence } from "@6g-path/gaussian-player";

const DEFAULT_FRAME_RATE = 30;
const DEFAULT_START_FRAME = 40;
const DEFAULT_END_FRAME = 50;

type Environment = Record<string, string | undefined>;

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
