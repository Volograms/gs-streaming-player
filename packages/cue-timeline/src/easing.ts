/** Clamps to 0..1, then eases with zero slope at both ends. */
export function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
