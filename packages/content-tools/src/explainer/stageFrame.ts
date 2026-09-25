export type Vec3 = readonly [number, number, number];
/** Row-major 3x3 matrix. */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export interface StageFrameDefinition {
  /** Direction in the source frame that becomes stage +X, projected onto the ground. */
  forward: Vec3;
  /** Ground point in the source frame that becomes the stage origin. */
  origin: Vec3;
  /** Ground normal in the source frame that becomes stage +Y. */
  up: Vec3;
}

export interface StageBox {
  max: Vec3;
  min: Vec3;
}

/**
 * Rigid mapping from a training (source) frame into the Y-up stage frame used by the
 * player: `stage = rotation * (source - origin)`.
 */
export interface StageFrame {
  origin: Vec3;
  rotation: Mat3;
}

export function createStageFrame(definition: StageFrameDefinition): StageFrame {
  const up = normalise(definition.up, "stage.up");
  const forward = normalise(
    subtract(definition.forward, scale(up, dot(definition.forward, up))),
    "stage.forward projected onto the ground",
  );
  const side = cross(forward, up);
  return { origin: definition.origin, rotation: [forward, up, side] };
}

export function toStagePoint(frame: StageFrame, point: Vec3): Vec3 {
  return multiplyVector(frame.rotation, subtract(point, frame.origin));
}

export function toStageRotation(frame: StageFrame, rotation: Mat3): Mat3 {
  return multiplyMatrix(frame.rotation, rotation);
}

export function isInsideBox(box: StageBox, point: Vec3): boolean {
  return point.every(
    (value, axis) => value >= box.min[axis]! && value <= box.max[axis]!,
  );
}

/**
 * SplatTransform applies its actions in PlayCanvas's PLY viewing frame, which is the
 * file frame rotated 180 degrees about Z (`F = diag(-1, -1, 1)`). The actions below are
 * conjugated by F so the written file coordinates are exactly the stage frame.
 * Rotations are emitted as single-axis steps to avoid depending on an Euler order.
 */
export function splatTransformStageArgs(frame: StageFrame, box: StageBox): string[] {
  const translation = flip(scale(frame.origin, -1));
  const [x, y, z] = eulerXyzDegrees(conjugateByFlip(frame.rotation));
  const boxMin = flip(box.min);
  const boxMax = flip(box.max);
  const filterBox = [
    Math.min(boxMin[0], boxMax[0]),
    Math.min(boxMin[1], boxMax[1]),
    box.min[2],
    Math.max(boxMin[0], boxMax[0]),
    Math.max(boxMin[1], boxMax[1]),
    box.max[2],
  ];
  return [
    `--translate=${formatList(translation)}`,
    `--rotate=0,0,${formatNumber(z)}`,
    `--rotate=0,${formatNumber(y)},0`,
    `--rotate=${formatNumber(x)},0,0`,
    `--filter-box=${formatList(filterBox)}`,
  ];
}

/** Decomposes `R = Rx(x) * Ry(y) * Rz(z)`, i.e. rotate about Z first, then Y, then X. */
export function eulerXyzDegrees(rotation: Mat3): Vec3 {
  const sinY = clamp(rotation[0][2], -1, 1);
  if (Math.abs(sinY) > 0.999999) {
    throw new Error("Stage rotation is too close to an Euler singularity.");
  }
  return [
    degrees(Math.atan2(-rotation[1][2], rotation[2][2])),
    degrees(Math.asin(sinY)),
    degrees(Math.atan2(-rotation[0][1], rotation[0][0])),
  ];
}

/** Quaternion `[w, x, y, z]` for a proper rotation matrix. */
export function quaternionFromMatrix(
  m: Mat3,
): readonly [number, number, number, number] {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = s / 4;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = s / 4;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = s / 4;
  }
  return w < 0 ? [-w, -x, -y, -z] : [w, x, y, z];
}

export function multiplyMatrix(left: Mat3, right: Mat3): Mat3 {
  const column = (index: number): Vec3 => [
    right[0][index]!,
    right[1][index]!,
    right[2][index]!,
  ];
  const row = (values: Vec3): Vec3 => [
    dot(values, column(0)),
    dot(values, column(1)),
    dot(values, column(2)),
  ];
  return [row(left[0]), row(left[1]), row(left[2])];
}

export function multiplyVector(matrix: Mat3, vector: Vec3): Vec3 {
  return [dot(matrix[0], vector), dot(matrix[1], vector), dot(matrix[2], vector)];
}

/** `F * m * F` with `F = diag(-1, -1, 1)`: negates the XZ, YZ, ZX and ZY terms. */
function conjugateByFlip(m: Mat3): Mat3 {
  return [
    [m[0][0], m[0][1], -m[0][2]],
    [m[1][0], m[1][1], -m[1][2]],
    [-m[2][0], -m[2][1], m[2][2]],
  ];
}

function flip(vector: Vec3): Vec3 {
  return [-vector[0], -vector[1], vector[2]];
}

function normalise(vector: Vec3, label: string): Vec3 {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-9) {
    throw new Error(`${label} must be a non-zero vector.`);
  }
  return scale(vector, 1 / length);
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function formatList(values: readonly number[]): string {
  return values.map(formatNumber).join(",");
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(6)) + 0);
}
