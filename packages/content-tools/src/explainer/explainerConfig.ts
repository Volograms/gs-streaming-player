import type { StageBox, StageFrameDefinition, Vec3 } from "./stageFrame.js";

export interface ExplainerCheckpointConfig {
  /** Training checkpoint PLY, relative to datasetDir. Omitted for the generated start state. */
  input?: string;
  iteration: number;
  /** "initialisation" generates iteration 0 from the sparse cloud. */
  source: "checkpoint" | "initialisation";
}

export interface ExplainerAssetsConfig {
  cameraCount: number;
  cameraTransforms: string;
  checkpoints: ExplainerCheckpointConfig[];
  cropBox: StageBox;
  datasetDir: string;
  id: string;
  maxSh: number;
  sparsePointCloud: string;
  stage: StageFrameDefinition;
  /** Directories scanned for splat_<iteration>.ply headers to build the counter curve. */
  trainingCountDirs: string[];
}

export function parseExplainerAssetsConfig(value: unknown): ExplainerAssetsConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Explainer config must be an object with version 1.");
  }
  const id = requireString(value.id, "id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      "Explainer config id must use lowercase letters, digits and dashes.",
    );
  }
  if (!isRecord(value.stage)) throw new Error("Explainer config stage is required.");
  if (!isRecord(value.cropBox))
    throw new Error("Explainer config cropBox is required.");
  const cropBox = {
    max: requireVec3(value.cropBox.max, "cropBox.max"),
    min: requireVec3(value.cropBox.min, "cropBox.min"),
  };
  if (cropBox.min.some((minimum, axis) => minimum >= cropBox.max[axis]!)) {
    throw new Error("cropBox.min must be smaller than cropBox.max on every axis.");
  }
  const maxSh = value.maxSh ?? 1;
  if (typeof maxSh !== "number" || !Number.isInteger(maxSh) || maxSh < 0 || maxSh > 3) {
    throw new Error("maxSh must be an integer between 0 and 3.");
  }
  const cameraCount = value.cameraCount ?? 20;
  if (
    typeof cameraCount !== "number" ||
    !Number.isInteger(cameraCount) ||
    cameraCount < 1
  ) {
    throw new Error("cameraCount must be a positive integer.");
  }
  if (!Array.isArray(value.trainingCountDirs)) {
    throw new Error("trainingCountDirs must be a list of directories.");
  }
  return {
    cameraCount,
    cameraTransforms: requireString(value.cameraTransforms, "cameraTransforms"),
    checkpoints: parseCheckpoints(value.checkpoints),
    cropBox,
    datasetDir: requireString(value.datasetDir, "datasetDir"),
    id,
    maxSh,
    sparsePointCloud: requireString(value.sparsePointCloud, "sparsePointCloud"),
    stage: {
      forward: requireVec3(value.stage.forward, "stage.forward"),
      origin: requireVec3(value.stage.origin, "stage.origin"),
      up: requireVec3(value.stage.up, "stage.up"),
    },
    trainingCountDirs: value.trainingCountDirs.map((dir, index) =>
      requireString(dir, `trainingCountDirs[${index}]`),
    ),
  };
}

function parseCheckpoints(value: unknown): ExplainerCheckpointConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("checkpoints must be a non-empty list.");
  }
  let previous = -1;
  return value.map((entry, index) => {
    const label = `checkpoints[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object.`);
    const iteration = entry.iteration;
    if (
      typeof iteration !== "number" ||
      !Number.isInteger(iteration) ||
      iteration <= previous
    ) {
      throw new Error(
        `${label}.iteration must be an integer above the previous checkpoint.`,
      );
    }
    previous = iteration;
    if (entry.source === "initialisation") {
      if (entry.input !== undefined || iteration !== 0) {
        throw new Error(
          `${label}: the initialisation state is iteration 0 without an input.`,
        );
      }
      return { iteration, source: "initialisation" };
    }
    if (entry.source !== undefined && entry.source !== "checkpoint") {
      throw new Error(`${label}.source must be 'checkpoint' or 'initialisation'.`);
    }
    const input = requireString(entry.input, `${label}.input`);
    if (!/\.ply$/i.test(input)) throw new Error(`${label}.input must be a PLY file.`);
    return { input, iteration, source: "checkpoint" };
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireVec3(value: unknown, label: string): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (component) => typeof component === "number" && Number.isFinite(component),
    )
  ) {
    throw new Error(`${label} must be an [x, y, z] list of finite numbers.`);
  }
  return [value[0], value[1], value[2]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
