import { quaternionFromMatrix, toStagePoint, toStageRotation } from "./stageFrame.js";

import type { RasterCamera } from "./renderGaussians.js";
import type { Mat3, StageFrame, Vec3 } from "./stageFrame.js";

export interface StageCamera {
  /** Source image path relative to the dataset directory. */
  image: string;
  position: Vec3;
  /** Camera-to-stage rotation `[w, x, y, z]`; the camera looks along its local -Z. */
  rotation: readonly [number, number, number, number];
}

export interface StageCameraSet {
  aspect: number;
  cameras: StageCamera[];
  height: number;
  totalCount: number;
  verticalFovDegrees: number;
  width: number;
}

interface NerfstudioFrame {
  file_path: string;
  transform_matrix: number[][];
}

/**
 * Converts nerfstudio camera-to-world poses (OpenGL camera axes, as used by OpenSplat
 * output) into the stage frame and keeps `count` cameras spread evenly by azimuth
 * around the stage's vertical axis.
 */
export function selectStageCameras(
  transforms: unknown,
  frame: StageFrame,
  count: number,
): StageCameraSet {
  const parsed = parseTransforms(transforms);
  const all = parsed.frames.map((source) => {
    const matrix = source.transform_matrix;
    const rotation = toStageRotation(frame, [
      [matrix[0]![0]!, matrix[0]![1]!, matrix[0]![2]!],
      [matrix[1]![0]!, matrix[1]![1]!, matrix[1]![2]!],
      [matrix[2]![0]!, matrix[2]![1]!, matrix[2]![2]!],
    ] as Mat3);
    const position = toStagePoint(frame, [
      matrix[0]![3]!,
      matrix[1]![3]!,
      matrix[2]![3]!,
    ]);
    return {
      azimuth: Math.atan2(position[0], position[2]),
      camera: {
        image: source.file_path,
        position: position.map(round) as unknown as Vec3,
        rotation: quaternionFromMatrix(rotation).map(
          round,
        ) as unknown as StageCamera["rotation"],
      },
    };
  });
  all.sort((left, right) => left.azimuth - right.azimuth);
  const selected =
    count >= all.length
      ? all
      : Array.from(
          { length: count },
          (_, index) => all[Math.floor((index * all.length) / count)]!,
        );
  return {
    aspect: round(parsed.width / parsed.height),
    cameras: selected.map(({ camera }) => camera),
    height: parsed.height,
    totalCount: all.length,
    verticalFovDegrees: round(
      (2 * Math.atan(parsed.height / 2 / parsed.fy) * 180) / Math.PI,
    ),
    width: parsed.width,
  };
}

/**
 * The training camera that took `image`, in the stage frame, with the dataset's pixel
 * intrinsics (lens distortion is ignored), ready for the offline rasteriser.
 */
export function stageRasterCamera(
  transforms: unknown,
  frame: StageFrame,
  image: string,
): RasterCamera {
  const parsed = parseTransforms(transforms);
  const record = transforms as Record<string, unknown>;
  const fx = record.fl_x;
  const cx = record.cx ?? parsed.width / 2;
  const cy = record.cy ?? parsed.height / 2;
  if (typeof fx !== "number" || typeof cx !== "number" || typeof cy !== "number") {
    throw new Error("Camera transforms need fl_x (and numeric cx, cy when present).");
  }
  const source = parsed.frames.find(({ file_path }) => file_path === image);
  if (source === undefined) throw new Error(`No camera frame for image '${image}'.`);
  const m = source.transform_matrix;
  const rotation = toStageRotation(frame, [
    [m[0]![0]!, m[0]![1]!, m[0]![2]!],
    [m[1]![0]!, m[1]![1]!, m[1]![2]!],
    [m[2]![0]!, m[2]![1]!, m[2]![2]!],
  ] as Mat3);
  // OpenGL camera axes: +X right, +Y up, looking down -Z.
  const column = (index: number): Vec3 => [
    rotation[0][index]!,
    rotation[1][index]!,
    rotation[2][index]!,
  ];
  const back = column(2);
  return {
    cx,
    cy,
    eye: toStagePoint(frame, [m[0]![3]!, m[1]![3]!, m[2]![3]!]),
    forward: [-back[0], -back[1], -back[2]],
    fx,
    fy: parsed.fy,
    height: parsed.height,
    right: column(0),
    up: column(1),
    width: parsed.width,
  };
}

function parseTransforms(value: unknown): {
  frames: NerfstudioFrame[];
  fy: number;
  height: number;
  width: number;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Camera transforms must be a nerfstudio transforms.json object.");
  }
  const record = value as Record<string, unknown>;
  const width = record.w;
  const height = record.h;
  const fy = record.fl_y;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof fy !== "number" ||
    !Array.isArray(record.frames) ||
    record.frames.length === 0
  ) {
    throw new Error(
      "Camera transforms need shared w, h, fl_y intrinsics and a non-empty frames list.",
    );
  }
  for (const frame of record.frames as unknown[]) {
    const candidate = frame as Partial<NerfstudioFrame> | null;
    if (
      typeof candidate?.file_path !== "string" ||
      !Array.isArray(candidate.transform_matrix) ||
      candidate.transform_matrix.length < 3 ||
      !candidate.transform_matrix
        .slice(0, 3)
        .every(
          (row) =>
            Array.isArray(row) &&
            row.length >= 4 &&
            row.every((v) => Number.isFinite(v)),
        )
    ) {
      throw new Error(
        "Every camera frame needs a file_path and a 4x4 transform_matrix.",
      );
    }
  }
  return { frames: record.frames as NerfstudioFrame[], fy, height, width };
}

function round(value: number): number {
  return Number(value.toFixed(6)) + 0;
}
