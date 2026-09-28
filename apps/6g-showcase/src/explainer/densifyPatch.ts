type Vec3Tuple = readonly [number, number, number];

export type PatchRole = "base" | "faint" | "split";

/** One gaussian of the densification/pruning demonstration patch (stage metres). */
export interface PatchGaussian {
  color: Vec3Tuple;
  /** Opacity before any pruning. */
  opacity: number;
  position: Vec3Tuple;
  role: PatchRole;
  /** In-sheet rotation of the long axis, radians about the sheet normal (local Z). */
  rotation: number;
  sigma: number;
  /** Per-axis sigma multipliers in the gaussian's own frame (X is the long axis). */
  stretch: Vec3Tuple;
}

export interface PatchLayout {
  gaussians: readonly PatchGaussian[];
  /** Indices of `faint` gaussians in pruning order. */
  pruneOrder: readonly number[];
}

const BASE_COUNT = 36;
const SPLIT_COUNT = 6;
const FAINT_COUNT = 10;
const HALF_WIDTH = 1.2;
const HALF_HEIGHT = 0.9;
const BASE_SIGMA = 0.085;

/**
 * A small, slightly curved sheet of gaussians standing in for a patch of surface, in
 * the demo object's colours. Deterministic for a given seed, so every viewer and every
 * seek sees the same patch.
 */
export function createDensifyPatch(
  palette: readonly Vec3Tuple[],
  seed = 7,
): PatchLayout {
  if (palette.length === 0) throw new Error("The patch needs at least one colour.");
  const random = mulberry32(seed);
  const colour = () => palette[Math.floor(random() * palette.length)]!;
  const onSheet = (x: number, y: number): Vec3Tuple => [x, y, -0.18 * x * x];
  const gaussians: PatchGaussian[] = [];

  // Base gaussians on a jittered grid covering the sheet.
  const columns = 6;
  const rows = BASE_COUNT / columns;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x =
        -HALF_WIDTH +
        ((column + 0.5 + (random() - 0.5) * 0.6) / columns) * 2 * HALF_WIDTH;
      const y =
        -HALF_HEIGHT + ((row + 0.5 + (random() - 0.5) * 0.6) / rows) * 2 * HALF_HEIGHT;
      gaussians.push({
        color: colour(),
        opacity: 0.85,
        position: onSheet(x, y),
        role: "base",
        rotation: random() * Math.PI,
        sigma: BASE_SIGMA * (0.75 + random() * 0.5),
        stretch: [1.25, 1, 0.35],
      });
    }
  }

  // Large, elongated gaussians that cover too much detail: they get split.
  for (let index = 0; index < SPLIT_COUNT; index += 1) {
    const x = -HALF_WIDTH * 0.8 + (index / (SPLIT_COUNT - 1)) * HALF_WIDTH * 1.6;
    const y = (index % 2 === 0 ? 0.45 : -0.4) * HALF_HEIGHT + (random() - 0.5) * 0.2;
    gaussians.push({
      color: colour(),
      opacity: 0.9,
      position: onSheet(x, y + 0),
      role: "split",
      rotation: (random() - 0.5) * 1.2,
      sigma: BASE_SIGMA * 1.35,
      stretch: [1.9, 0.85, 0.35],
    });
  }

  // Faint gaussians that add little to the image: they get pruned.
  for (let index = 0; index < FAINT_COUNT; index += 1) {
    const x = (random() * 2 - 1) * HALF_WIDTH * 1.05;
    const y = (random() * 2 - 1) * HALF_HEIGHT * 1.1;
    gaussians.push({
      color: colour(),
      opacity: 0.2 + random() * 0.1,
      position: [x, y, -0.18 * x * x + 0.05],
      role: "faint",
      rotation: random() * Math.PI,
      sigma: BASE_SIGMA * (0.8 + random() * 0.4),
      stretch: [1.2, 1, 0.35],
    });
  }

  const faint = gaussians.flatMap((gaussian, index) =>
    gaussian.role === "faint" ? [index] : [],
  );
  const pruneOrder = faint
    .map((index) => ({ index, key: random() }))
    .sort((left, right) => left.key - right.key)
    .map(({ index }) => index);
  return { gaussians, pruneOrder };
}

/** Small deterministic PRNG (Mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
