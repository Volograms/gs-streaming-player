import type { PlyVertices } from "./plyFiles.js";

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

/** Gaussians in the 3DGS PLY encoding, decoded to linear values. */
export interface GaussianCloud {
  count: number;
  /** Opacity after the sigmoid, 0..1. */
  opacities: Float32Array;
  positions: Float32Array;
  /** Unit quaternions `w, x, y, z`. */
  rotations: Float32Array;
  /** Linear per-axis sigma (after exp). */
  scales: Float32Array;
  /** SH degree-0 coefficient per channel. */
  shDc: Float32Array;
  /** SH degree-1 coefficients, 3 per channel (R, G, B), or undefined. */
  shRest: Float32Array | undefined;
}

/** A look-at pinhole camera with square pixels. */
export interface PinholeCamera {
  eye: Vec3;
  height: number;
  lookAt: Vec3;
  verticalFovDegrees: number;
  width: number;
}

const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const NEAR = 0.2;
/** Screen-space dilation added to every projected covariance (as in 3DGS). */
const LOW_PASS = 0.3;

export function gaussiansFromPly(vertices: PlyVertices): GaussianCloud {
  const column = (name: string) => {
    const index = vertices.names.indexOf(name);
    if (index < 0) throw new Error(`Gaussian PLY has no '${name}' property.`);
    return index;
  };
  const optional = (name: string) => vertices.names.indexOf(name);
  const stride = vertices.names.length;
  const get = (vertex: number, index: number) =>
    vertices.data[vertex * stride + index]!;
  const [x, y, z] = ["x", "y", "z"].map(column) as [number, number, number];
  const scale = ["scale_0", "scale_1", "scale_2"].map(column);
  const rot = ["rot_0", "rot_1", "rot_2", "rot_3"].map(column);
  const dc = ["f_dc_0", "f_dc_1", "f_dc_2"].map(column);
  const opacity = column("opacity");
  const rest = Array.from({ length: 9 }, (_, index) => optional(`f_rest_${index}`));
  const hasRest = rest.every((index) => index >= 0);
  // With more than one band stored, channel blocks are longer than 3 coefficients.
  const restCount = vertices.names.filter((name) => name.startsWith("f_rest_")).length;
  const perChannel = restCount / 3;

  const count = vertices.count;
  const cloud: GaussianCloud = {
    count,
    opacities: new Float32Array(count),
    positions: new Float32Array(count * 3),
    rotations: new Float32Array(count * 4),
    scales: new Float32Array(count * 3),
    shDc: new Float32Array(count * 3),
    shRest: hasRest ? new Float32Array(count * 9) : undefined,
  };
  for (let vertex = 0; vertex < count; vertex += 1) {
    cloud.positions.set([get(vertex, x), get(vertex, y), get(vertex, z)], vertex * 3);
    for (let axis = 0; axis < 3; axis += 1) {
      cloud.scales[vertex * 3 + axis] = Math.exp(get(vertex, scale[axis]!));
      cloud.shDc[vertex * 3 + axis] = get(vertex, dc[axis]!);
    }
    const q = rot.map((index) => get(vertex, index));
    const length = Math.hypot(...q) || 1;
    cloud.rotations.set(
      q.map((value) => value / length),
      vertex * 4,
    );
    cloud.opacities[vertex] = 1 / (1 + Math.exp(-get(vertex, opacity)));
    if (cloud.shRest !== undefined) {
      for (let channel = 0; channel < 3; channel += 1) {
        for (let k = 0; k < 3; k += 1) {
          const name = `f_rest_${channel * perChannel + k}`;
          cloud.shRest[vertex * 9 + channel * 3 + k] = get(vertex, column(name));
        }
      }
    }
  }
  return cloud;
}

/**
 * CPU 3D Gaussian Splatting rasteriser (EWA projection, depth sort, front-to-back
 * alpha compositing, SH up to degree 1). Returns straight-alpha RGBA where alpha is the
 * accumulated coverage, so an empty background stays transparent.
 */
export function renderGaussians(
  cloud: GaussianCloud,
  camera: PinholeCamera,
): Uint8ClampedArray {
  const { height, width } = camera;
  const forward = normalise(subtract(camera.lookAt, camera.eye));
  const right = normalise(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = height / 2 / Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
  const cx = width / 2;
  const cy = height / 2;

  interface Projected {
    alphaScale: number;
    color: Vec3;
    conic: Vec3;
    depth: number;
    px: number;
    py: number;
    radius: number;
  }
  const projected: Projected[] = [];
  for (let i = 0; i < cloud.count; i += 1) {
    const p: Vec3 = [
      cloud.positions[i * 3]!,
      cloud.positions[i * 3 + 1]!,
      cloud.positions[i * 3 + 2]!,
    ];
    const d = subtract(p, camera.eye);
    // Camera coordinates: x right, y down, z forward.
    const xc = dot(d, right);
    const yc = -dot(d, up);
    const zc = dot(d, forward);
    if (zc < NEAR) continue;

    const covariance = worldCovariance(cloud, i);
    // Rows of the world-to-camera rotation.
    const w: Mat3 = [right, [-up[0], -up[1], -up[2]], forward];
    const cam = congruence(w, covariance);
    const j00 = focal / zc;
    const j02 = (-focal * xc) / (zc * zc);
    const j11 = focal / zc;
    const j12 = (-focal * yc) / (zc * zc);
    // Sigma2D = J * cam * J^T for J = [[j00, 0, j02], [0, j11, j12]].
    const a =
      j00 * j00 * cam[0][0] +
      2 * j00 * j02 * cam[0][2] +
      j02 * j02 * cam[2][2] +
      LOW_PASS;
    const b =
      j00 * j11 * cam[0][1] +
      j00 * j12 * cam[0][2] +
      j02 * j11 * cam[1][2] +
      j02 * j12 * cam[2][2];
    const c =
      j11 * j11 * cam[1][1] +
      2 * j11 * j12 * cam[1][2] +
      j12 * j12 * cam[2][2] +
      LOW_PASS;
    const det = a * c - b * b;
    if (!(det > 0)) continue;
    const mid = (a + c) / 2;
    const lambda = mid + Math.sqrt(Math.max(0.1, mid * mid - det));
    const radius = Math.ceil(3 * Math.sqrt(lambda));
    const px = cx + (focal * xc) / zc;
    const py = cy + (focal * yc) / zc;
    if (
      px + radius < 0 ||
      px - radius >= width ||
      py + radius < 0 ||
      py - radius >= height
    ) {
      continue;
    }
    projected.push({
      alphaScale: cloud.opacities[i]!,
      color: shColor(cloud, i, normalise(d)),
      conic: [c / det, -b / det, a / det],
      depth: zc,
      px,
      py,
      radius,
    });
  }
  projected.sort((left, right) => left.depth - right.depth);

  const accumulated = new Float32Array(width * height * 3);
  const transmittance = new Float32Array(width * height).fill(1);
  for (const g of projected) {
    const x0 = Math.max(0, Math.floor(g.px - g.radius));
    const x1 = Math.min(width - 1, Math.ceil(g.px + g.radius));
    const y0 = Math.max(0, Math.floor(g.py - g.radius));
    const y1 = Math.min(height - 1, Math.ceil(g.py + g.radius));
    for (let y = y0; y <= y1; y += 1) {
      const dy = g.py - (y + 0.5);
      for (let x = x0; x <= x1; x += 1) {
        const pixel = y * width + x;
        const t = transmittance[pixel]!;
        if (t < 1e-4) continue;
        const dx = g.px - (x + 0.5);
        const power =
          -0.5 * (g.conic[0] * dx * dx + g.conic[2] * dy * dy) - g.conic[1] * dx * dy;
        if (power > 0) continue;
        const alpha = Math.min(0.99, g.alphaScale * Math.exp(power));
        if (alpha < 1 / 255) continue;
        const weight = alpha * t;
        accumulated[pixel * 3] = accumulated[pixel * 3]! + g.color[0] * weight;
        accumulated[pixel * 3 + 1] = accumulated[pixel * 3 + 1]! + g.color[1] * weight;
        accumulated[pixel * 3 + 2] = accumulated[pixel * 3 + 2]! + g.color[2] * weight;
        transmittance[pixel] = t * (1 - alpha);
      }
    }
  }

  const image = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const coverage = 1 - transmittance[pixel]!;
    image[pixel * 4 + 3] = coverage * 255;
    if (coverage <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      image[pixel * 4 + channel] = (accumulated[pixel * 3 + channel]! / coverage) * 255;
    }
  }
  return image;
}

function worldCovariance(cloud: GaussianCloud, i: number): Mat3 {
  const w = cloud.rotations[i * 4]!;
  const x = cloud.rotations[i * 4 + 1]!;
  const y = cloud.rotations[i * 4 + 2]!;
  const z = cloud.rotations[i * 4 + 3]!;
  const sx = cloud.scales[i * 3]!;
  const sy = cloud.scales[i * 3 + 1]!;
  const sz = cloud.scales[i * 3 + 2]!;
  // M = R * S; Sigma = M * M^T.
  const m: Mat3 = [
    [
      (1 - 2 * (y * y + z * z)) * sx,
      2 * (x * y - w * z) * sy,
      2 * (x * z + w * y) * sz,
    ],
    [
      2 * (x * y + w * z) * sx,
      (1 - 2 * (x * x + z * z)) * sy,
      2 * (y * z - w * x) * sz,
    ],
    [
      2 * (x * z - w * y) * sx,
      2 * (y * z + w * x) * sy,
      (1 - 2 * (x * x + y * y)) * sz,
    ],
  ];
  return [
    [dot(m[0], m[0]), dot(m[0], m[1]), dot(m[0], m[2])],
    [dot(m[1], m[0]), dot(m[1], m[1]), dot(m[1], m[2])],
    [dot(m[2], m[0]), dot(m[2], m[1]), dot(m[2], m[2])],
  ];
}

/** W * M * W^T for a symmetric M and rotation rows W. */
function congruence(w: Mat3, m: Mat3): Mat3 {
  const columns: Mat3 = [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
  const wm: Mat3 = [
    [dot(w[0], columns[0]), dot(w[0], columns[1]), dot(w[0], columns[2])],
    [dot(w[1], columns[0]), dot(w[1], columns[1]), dot(w[1], columns[2])],
    [dot(w[2], columns[0]), dot(w[2], columns[1]), dot(w[2], columns[2])],
  ];
  return [
    [dot(wm[0], w[0]), dot(wm[0], w[1]), dot(wm[0], w[2])],
    [dot(wm[1], w[0]), dot(wm[1], w[1]), dot(wm[1], w[2])],
    [dot(wm[2], w[0]), dot(wm[2], w[1]), dot(wm[2], w[2])],
  ];
}

function shColor(cloud: GaussianCloud, i: number, direction: Vec3): Vec3 {
  const colour = [0, 1, 2].map((channel) => {
    let value = 0.5 + SH_C0 * cloud.shDc[i * 3 + channel]!;
    if (cloud.shRest !== undefined) {
      const base = i * 9 + channel * 3;
      value +=
        -SH_C1 * direction[1] * cloud.shRest[base]! +
        SH_C1 * direction[2] * cloud.shRest[base + 1]! -
        SH_C1 * direction[0] * cloud.shRest[base + 2]!;
    }
    return Math.max(0, value);
  });
  return [colour[0]!, colour[1]!, colour[2]!];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
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

function normalise(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
