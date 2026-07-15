import type { Transform } from "@6g-path/shared";

/** Converts the current capture fixtures into the demo's Three.js world coordinates. */
export const CAPTURE_TO_THREE_TRANSFORM = Object.freeze({
  rotation: Object.freeze({ w: 0, x: 1, y: 0, z: 0 }),
}) satisfies Transform;
