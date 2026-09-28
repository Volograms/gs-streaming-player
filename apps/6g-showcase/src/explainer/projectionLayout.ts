import type { SparsePoints } from "./explainerAssets.js";

type Vec3Tuple = readonly [number, number, number];

/** The look-at pinhole camera the projection image was rendered with (stage frame). */
export interface ProjectionCamera {
  eye: Vec3Tuple;
  height: number;
  lookAt: Vec3Tuple;
  verticalFovDegrees: number;
  width: number;
}

/** Per-gaussian data for the 3D-to-2D projection, sorted far to near. */
export interface ProjectionLayout {
  colors: Float32Array;
  count: number;
  /** 0..1 start of each gaussian's flight within the beat. */
  delays: Float32Array;
  /** Blob radius on the object, in stage metres. */
  radii3d: Float32Array;
  /** Splat radius on the screen, in screen units. */
  radii2d: Float32Array;
  /** Stage-frame start positions. */
  starts: Float32Array;
  /** Screen-plane landing positions (x right, y up), in screen units. */
  targets: Float32Array;
}

const MIN_RADIUS = 0.06;
const MAX_RADIUS = 0.16;
/** Screen splats are drawn a little larger than a strict projection to close gaps. */
const SCREEN_SPLAT_BOOST = 1.25;

/**
 * Projects a subsample of the sparse cloud through the same pinhole camera that
 * rendered the projection image, onto a screen of `halfWidth` x `halfHeight` that shows
 * that image edge to edge. Each flying gaussian therefore lands where its part of the
 * object is in the final image. Points outside the frame are left out. The result is
 * ordered far to near, the order a splat rasteriser blends in.
 */
export function createProjectionLayout(
  points: SparsePoints,
  camera: ProjectionCamera,
  screen: { halfHeight: number; halfWidth: number },
  maxCount = 12000,
): ProjectionLayout {
  const forward = normalise(subtract(camera.lookAt, camera.eye));
  const right = normalise(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal =
    camera.height / 2 / Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
  // Screen units per image pixel (the image fills the screen).
  const unitsPerPixel = (2 * screen.halfWidth) / camera.width;
  const stride = Math.max(1, Math.ceil(points.count / maxCount));
  const sampled: {
    depth: number;
    index: number;
    radius: number;
    x: number;
    y: number;
  }[] = [];
  for (let index = 0; index < points.count; index += stride) {
    const offset = subtract(
      [
        points.positions[index * 3]!,
        points.positions[index * 3 + 1]!,
        points.positions[index * 3 + 2]!,
      ],
      camera.eye,
    );
    const depth = dot(offset, forward);
    if (depth <= 1e-3) continue;
    const x = (dot(offset, right) / depth) * focal * unitsPerPixel;
    const y = (dot(offset, up) / depth) * focal * unitsPerPixel;
    if (Math.abs(x) > screen.halfWidth || Math.abs(y) > screen.halfHeight) continue;
    sampled.push({
      depth,
      index,
      radius: Math.min(Math.max(points.scales[index]! * 3, MIN_RADIUS), MAX_RADIUS),
      x,
      y,
    });
  }
  if (sampled.length === 0) throw new Error("No sparse points fall inside the image.");

  sampled.sort((left, right) => right.depth - left.depth);
  const count = sampled.length;
  const layout: ProjectionLayout = {
    colors: new Float32Array(count * 3),
    count,
    delays: new Float32Array(count),
    radii2d: new Float32Array(count),
    radii3d: new Float32Array(count),
    starts: new Float32Array(count * 3),
    targets: new Float32Array(count * 2),
  };
  sampled.forEach((item, order) => {
    const i = item.index;
    layout.starts.set(points.positions.subarray(i * 3, i * 3 + 3), order * 3);
    layout.colors.set(
      [
        points.colors[i * 3]! / 255,
        points.colors[i * 3 + 1]! / 255,
        points.colors[i * 3 + 2]! / 255,
      ],
      order * 3,
    );
    layout.radii3d[order] = item.radius;
    layout.radii2d[order] =
      (item.radius / item.depth) * focal * unitsPerPixel * SCREEN_SPLAT_BOOST;
    layout.targets[order * 2] = item.x;
    layout.targets[order * 2 + 1] = item.y;
    // Spread departures deterministically (golden-ratio sequence).
    layout.delays[order] = 0.06 + 0.22 * ((i * 0.6180339887) % 1);
  });
  return layout;
}

function subtract(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vec3Tuple, right: Vec3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalise(vector: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
