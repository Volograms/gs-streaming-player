import type { Keyframe } from "@6g-path/cue-timeline";

/** The subset of `explainer-assets.json` (from `gs-content build-explainer`) the app uses. */
export interface ExplainerAssets {
  /** Capture cameras in the stage frame (camera looks down its local -Z). */
  cameras: StageCameraSet;
  checkpoints: ExplainerCheckpoint[];
  /** A training photo and each checkpoint rendered from its camera, if the assets have them. */
  comparison: ComparisonIndex | undefined;
  /** Opaque gaussians of the final model for the ellipsoid view, if the assets have them. */
  ellipsoids: { count: number; url: string } | undefined;
  /** Offline render of the final model from a virtual camera, if the assets have one. */
  projectionView: ProjectionView | undefined;
  sparsePoints: SparsePointsIndex;
  /** Real gaussian counts during training, keyed by iteration. */
  trainingCounts: Keyframe[];
}

export interface ExplainerCheckpoint {
  iteration: number;
  splatCount: number;
  /** Absolute URL of the stage-frame SOG. */
  url: string;
}

export interface ComparisonIndex {
  /** Index into the capture camera list: the camera the explainer highlights. */
  camera: number;
  height: number;
  /** Absolute URL of the real training photo. */
  photoUrl: string;
  /** Straight-alpha renders of the object from that camera, by iteration. */
  renders: { iteration: number; url: string }[];
  width: number;
}

/** A look-at pinhole camera in the stage frame and the image it rendered. */
export interface ProjectionView {
  eye: readonly [number, number, number];
  height: number;
  lookAt: readonly [number, number, number];
  /** Absolute URL of the rendered PNG. */
  url: string;
  verticalFovDegrees: number;
  width: number;
}

export interface StageCameraSet {
  aspect: number;
  cameras: {
    image: string;
    position: readonly [number, number, number];
    /** Camera-to-stage rotation `[w, x, y, z]`. */
    rotation: readonly [number, number, number, number];
  }[];
  verticalFovDegrees: number;
}

export interface SparsePointsIndex {
  colorsByteOffset: number;
  count: number;
  positionsByteOffset: number;
  scalesByteOffset: number;
  /** Absolute URL of the binary cloud. */
  url: string;
}

/** The SfM sparse cloud in stage units, with each point's initial gaussian sigma. */
export interface SparsePoints {
  colors: Uint8Array;
  count: number;
  positions: Float32Array;
  scales: Float32Array;
}

export async function loadSparsePoints(
  index: SparsePointsIndex,
  signal?: AbortSignal,
): Promise<SparsePoints> {
  const response = await fetch(index.url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`Sparse points unavailable (${response.status}): ${index.url}`);
  }
  return decodeSparsePoints(await response.arrayBuffer(), index);
}

export function decodeSparsePoints(
  buffer: ArrayBuffer,
  index: SparsePointsIndex,
): SparsePoints {
  const { colorsByteOffset, count, positionsByteOffset, scalesByteOffset } = index;
  if (buffer.byteLength < colorsByteOffset + count * 3) {
    throw new Error("Sparse points file is shorter than its index describes.");
  }
  return {
    colors: new Uint8Array(buffer, colorsByteOffset, count * 3),
    count,
    positions: new Float32Array(buffer, positionsByteOffset, count * 3),
    scales: new Float32Array(buffer, scalesByteOffset, count),
  };
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
  return {
    cameras: parseCameras(value.cameras),
    checkpoints,
    comparison: parseComparisonIndex(value.comparison, baseUrl),
    ellipsoids: parseEllipsoidsIndex(value.ellipsoids, baseUrl),
    projectionView: parseProjectionView(value.projectionView, baseUrl),
    sparsePoints: parseSparsePointsIndex(value.sparsePoints, baseUrl),
    trainingCounts,
  };
}

/** Floats per ellipsoid: position (3), rotation w,x,y,z (4), sigma (3), colour (3). */
export const ELLIPSOID_STRIDE = 13;

export async function loadEllipsoids(
  index: { count: number; url: string },
  signal?: AbortSignal,
): Promise<Float32Array> {
  const response = await fetch(index.url, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`Ellipsoids unavailable (${response.status}): ${index.url}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== index.count * ELLIPSOID_STRIDE * 4) {
    throw new Error("Ellipsoids file does not match its index; rebuild the assets.");
  }
  return new Float32Array(buffer);
}

function parseComparisonIndex(
  value: unknown,
  baseUrl: string,
): ComparisonIndex | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !isCount(value.camera) ||
    !isCount(value.width) ||
    !isCount(value.height) ||
    typeof value.photoUrl !== "string" ||
    !Array.isArray(value.renders)
  ) {
    throw new Error("Explainer comparison index is malformed; rebuild the assets.");
  }
  const renders = value.renders.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !isCount(entry.iteration) ||
      typeof entry.url !== "string"
    ) {
      throw new Error(`Explainer comparison render ${index} is malformed.`);
    }
    return { iteration: entry.iteration, url: new URL(entry.url, baseUrl).href };
  });
  return {
    camera: value.camera,
    height: value.height,
    photoUrl: new URL(value.photoUrl, baseUrl).href,
    renders,
    width: value.width,
  };
}

function parseEllipsoidsIndex(
  value: unknown,
  baseUrl: string,
): { count: number; url: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.url !== "string" || !isCount(value.count)) {
    throw new Error("Explainer ellipsoids index is malformed; rebuild the assets.");
  }
  return { count: value.count, url: new URL(value.url, baseUrl).href };
}

function parseProjectionView(
  value: unknown,
  baseUrl: string,
): ProjectionView | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    !isNumberList(value.eye, 3) ||
    !isNumberList(value.lookAt, 3) ||
    !isCount(value.width) ||
    !isCount(value.height) ||
    typeof value.verticalFovDegrees !== "number"
  ) {
    throw new Error("Explainer projection view is malformed; rebuild the assets.");
  }
  return {
    eye: value.eye as unknown as ProjectionView["eye"],
    height: value.height,
    lookAt: value.lookAt as unknown as ProjectionView["lookAt"],
    url: new URL(value.url, baseUrl).href,
    verticalFovDegrees: value.verticalFovDegrees,
    width: value.width,
  };
}

function parseCameras(value: unknown): StageCameraSet {
  if (
    !isRecord(value) ||
    !Array.isArray(value.cameras) ||
    typeof value.aspect !== "number" ||
    typeof value.verticalFovDegrees !== "number"
  ) {
    throw new Error("Explainer assets have no camera set.");
  }
  const cameras = value.cameras.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.image !== "string" ||
      !isNumberList(entry.position, 3) ||
      !isNumberList(entry.rotation, 4)
    ) {
      throw new Error(`Explainer camera ${index} is malformed.`);
    }
    return {
      image: entry.image,
      position: entry.position as unknown as readonly [number, number, number],
      rotation: entry.rotation as unknown as readonly [number, number, number, number],
    };
  });
  return {
    aspect: value.aspect,
    cameras,
    verticalFovDegrees: value.verticalFovDegrees,
  };
}

function parseSparsePointsIndex(value: unknown, baseUrl: string): SparsePointsIndex {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    !isCount(value.count) ||
    !isCount(value.positionsByteOffset) ||
    !isCount(value.scalesByteOffset) ||
    !isCount(value.colorsByteOffset)
  ) {
    throw new Error("Explainer sparse points index is malformed; rebuild the assets.");
  }
  return {
    colorsByteOffset: value.colorsByteOffset,
    count: value.count,
    positionsByteOffset: value.positionsByteOffset,
    scalesByteOffset: value.scalesByteOffset,
    url: new URL(value.url, baseUrl).href,
  };
}

function isNumberList(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
