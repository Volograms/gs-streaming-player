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
  /** Union of non-overlapping stage-frame boxes kept after cropping. */
  cropBoxes: StageBox[];
  datasetDir: string;
  id: string;
  /** Optional photo and per-checkpoint renders from one training camera. */
  comparisonView: ComparisonViewConfig | undefined;
  /** Optional export of a checkpoint's opaque gaussians for an ellipsoid view. */
  ellipsoidView: EllipsoidViewConfig | undefined;
  maxSh: number;
  /** Optional render of one checkpoint from a virtual camera (the explainer's 2D image). */
  projectionView: ProjectionViewConfig | undefined;
  sparsePointCloud: string;
  stage: StageFrameDefinition;
  /** Directories scanned for splat_<iteration>.ply headers to build the counter curve. */
  trainingCountDirs: string[];
}

export interface ComparisonViewConfig {
  /** Index into the selected camera ring (the camera the explainer highlights). */
  camera: number;
}

export interface EllipsoidViewConfig {
  count: number;
  iteration: number;
}

/** A look-at pinhole camera in stage metres and the checkpoint it renders. */
export interface ProjectionViewConfig {
  eye: Vec3;
  height: number;
  iteration: number;
  lookAt: Vec3;
  verticalFovDegrees: number;
  width: number;
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
  const cropBoxes = parseCropBoxes(value.cropBoxes);
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
    cropBoxes,
    datasetDir: requireString(value.datasetDir, "datasetDir"),
    id,
    comparisonView: parseComparisonView(value.comparisonView, cameraCount),
    ellipsoidView: parseEllipsoidView(value.ellipsoidView),
    maxSh,
    projectionView: parseProjectionView(value.projectionView),
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

function parseComparisonView(
  value: unknown,
  cameraCount: number,
): ComparisonViewConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("comparisonView must be an object.");
  const camera = value.camera;
  if (
    typeof camera !== "number" ||
    !Number.isInteger(camera) ||
    camera < 0 ||
    camera >= cameraCount
  ) {
    throw new Error("comparisonView.camera must index the selected camera ring.");
  }
  return { camera };
}

function parseCropBoxes(value: unknown): StageBox[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("cropBoxes must be a non-empty list of { min, max } boxes.");
  }
  const boxes = value.map((entry, index): StageBox => {
    const label = `cropBoxes[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object.`);
    const box = {
      max: requireVec3(entry.max, `${label}.max`),
      min: requireVec3(entry.min, `${label}.min`),
    };
    if (box.min.some((minimum, axis) => minimum >= box.max[axis]!)) {
      throw new Error(`${label}.min must be smaller than max on every axis.`);
    }
    return box;
  });
  // Each box is cropped separately and the parts are concatenated, so an overlap would
  // duplicate gaussians.
  boxes.forEach((box, index) => {
    boxes.slice(index + 1).forEach((other, offset) => {
      const overlaps = box.min.every(
        (minimum, axis) =>
          minimum < other.max[axis]! && other.min[axis]! < box.max[axis]!,
      );
      if (overlaps) {
        throw new Error(
          `cropBoxes[${index}] overlaps cropBoxes[${index + offset + 1}].`,
        );
      }
    });
  });
  return boxes;
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

function parseEllipsoidView(value: unknown): EllipsoidViewConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("ellipsoidView must be an object.");
  const { count, iteration } = value;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20000
  ) {
    throw new Error("ellipsoidView.count must be an integer between 1 and 20000.");
  }
  if (typeof iteration !== "number" || !Number.isInteger(iteration)) {
    throw new Error("ellipsoidView.iteration must name a configured checkpoint.");
  }
  return { count, iteration };
}

function parseProjectionView(value: unknown): ProjectionViewConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("projectionView must be an object.");
  const size = (field: "height" | "width") => {
    const pixels = value[field];
    if (
      typeof pixels !== "number" ||
      !Number.isInteger(pixels) ||
      pixels < 16 ||
      pixels > 4096
    ) {
      throw new Error(
        `projectionView.${field} must be an integer number of pixels (16-4096).`,
      );
    }
    return pixels;
  };
  const fov = value.verticalFovDegrees;
  if (typeof fov !== "number" || !(fov > 1 && fov < 170)) {
    throw new Error("projectionView.verticalFovDegrees must be between 1 and 170.");
  }
  const iteration = value.iteration;
  if (typeof iteration !== "number" || !Number.isInteger(iteration)) {
    throw new Error("projectionView.iteration must name a configured checkpoint.");
  }
  return {
    eye: requireVec3(value.eye, "projectionView.eye"),
    height: size("height"),
    iteration,
    lookAt: requireVec3(value.lookAt, "projectionView.lookAt"),
    verticalFovDegrees: fov,
    width: size("width"),
  };
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
