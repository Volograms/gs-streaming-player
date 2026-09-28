import type { PointCloud } from "./plyFiles.js";

export const INITIAL_GAUSSIAN_PROPERTIES = [
  "x",
  "y",
  "z",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
] as const;

const SH_C0 = 0.28209479177387814;
const INITIAL_OPACITY = 0.1;
const NEIGHBOUR_COUNT = 3;

/**
 * Gaussians as 3DGS/OpenSplat initialise them before iteration 1: one isotropic gaussian
 * per sparse point, sized by the mean distance to its three nearest neighbours, with
 * opacity 0.1 and the point colour as the SH DC term. Values use the PLY encoding
 * (log scale, logit opacity).
 */
export function createInitialGaussians(
  cloud: PointCloud,
  distances: Float32Array = initialScales(cloud),
): Float32Array {
  const stride = INITIAL_GAUSSIAN_PROPERTIES.length;
  const values = new Float32Array(cloud.count * stride);
  const opacity = Math.log(INITIAL_OPACITY / (1 - INITIAL_OPACITY));
  for (let point = 0; point < cloud.count; point += 1) {
    const out = point * stride;
    const logScale = Math.log(Math.max(distances[point]!, 1e-7));
    values.set(cloud.positions.subarray(point * 3, point * 3 + 3), out);
    for (let channel = 0; channel < 3; channel += 1) {
      values[out + 3 + channel] =
        (cloud.colors[point * 3 + channel]! / 255 - 0.5) / SH_C0;
    }
    values[out + 6] = opacity;
    values[out + 7] = logScale;
    values[out + 8] = logScale;
    values[out + 9] = logScale;
    values[out + 10] = 1;
  }
  return values;
}

/** Per-point initial gaussian scale (sigma): mean distance to the nearest neighbours. */
export function initialScales(cloud: PointCloud): Float32Array {
  return meanNeighbourDistances(cloud.positions, NEIGHBOUR_COUNT);
}

/** Exact k-nearest-neighbour mean distance using a k-d tree. */
export function meanNeighbourDistances(
  positions: Float32Array,
  k: number,
): Float32Array {
  const count = positions.length / 3;
  const result = new Float32Array(count);
  if (count <= 1) return result;
  const neighbours = Math.min(k, count - 1);
  const tree = buildKdTree(positions, count);
  const best = new Float64Array(neighbours);
  for (let i = 0; i < count; i += 1) {
    best.fill(Infinity);
    searchKdTree(tree, positions, i, 0, count, 0, best);
    let sum = 0;
    for (const squared of best) sum += Math.sqrt(squared);
    result[i] = sum / neighbours;
  }
  return result;
}

/** Point indices arranged so each subrange's median splits on axis = depth % 3. */
function buildKdTree(positions: Float32Array, count: number): Uint32Array {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  const stack: [number, number, number][] = [[0, count, 0]];
  while (stack.length > 0) {
    const [start, end, depth] = stack.pop()!;
    if (end - start <= 1) continue;
    const axis = depth % 3;
    const middle = (start + end) >> 1;
    selectNth(order, positions, start, end - 1, middle, axis);
    stack.push([start, middle, depth + 1], [middle + 1, end, depth + 1]);
  }
  return order;
}

/** Quickselect: places the nth-smallest (by axis) at n with smaller left, larger right. */
function selectNth(
  order: Uint32Array,
  positions: Float32Array,
  left: number,
  right: number,
  n: number,
  axis: number,
): void {
  const value = (slot: number) => positions[order[slot]! * 3 + axis]!;
  while (right > left) {
    const pivot = value((left + right) >> 1);
    let i = left;
    let j = right;
    while (i <= j) {
      while (value(i) < pivot) i += 1;
      while (value(j) > pivot) j -= 1;
      if (i <= j) {
        const swap = order[i]!;
        order[i] = order[j]!;
        order[j] = swap;
        i += 1;
        j -= 1;
      }
    }
    if (n <= j) right = j;
    else if (n >= i) left = i;
    else return;
  }
}

function searchKdTree(
  tree: Uint32Array,
  positions: Float32Array,
  query: number,
  start: number,
  end: number,
  depth: number,
  best: Float64Array,
): void {
  if (start >= end) return;
  const middle = (start + end) >> 1;
  const point = tree[middle]!;
  if (point !== query) {
    const dx = positions[point * 3]! - positions[query * 3]!;
    const dy = positions[point * 3 + 1]! - positions[query * 3 + 1]!;
    const dz = positions[point * 3 + 2]! - positions[query * 3 + 2]!;
    insertSorted(best, dx * dx + dy * dy + dz * dz);
  }
  const axis = depth % 3;
  const delta = positions[query * 3 + axis]! - positions[point * 3 + axis]!;
  const [near, far] =
    delta < 0
      ? [
          [start, middle],
          [middle + 1, end],
        ]
      : [
          [middle + 1, end],
          [start, middle],
        ];
  searchKdTree(tree, positions, query, near[0]!, near[1]!, depth + 1, best);
  if (delta * delta < best[best.length - 1]!) {
    searchKdTree(tree, positions, query, far[0]!, far[1]!, depth + 1, best);
  }
}

function insertSorted(best: Float64Array, value: number): void {
  if (value >= best[best.length - 1]!) return;
  let index = best.length - 1;
  while (index > 0 && best[index - 1]! > value) {
    best[index] = best[index - 1]!;
    index -= 1;
  }
  best[index] = value;
}
