export interface Vector3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionTuple {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position?: Vector3Tuple;
  /** Quaternion rotation, normalized by renderers; zero length falls back to identity. */
  rotation?: QuaternionTuple;
  scale?: Vector3Tuple;
  matrix?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

/** Keep quaternion magnitude from introducing scale into a rotation matrix. */
export function normalizeRotation(rotation?: QuaternionTuple): QuaternionTuple {
  if (rotation === undefined) return { w: 1, x: 0, y: 0, z: 0 };
  const { w, x, y, z } = rotation;
  const largest = Math.max(Math.abs(w), Math.abs(x), Math.abs(y), Math.abs(z));
  if (!Number.isFinite(largest)) {
    throw new Error("Transform rotation must contain only finite numbers.");
  }
  if (largest === 0) return { w: 1, x: 0, y: 0, z: 0 };
  // Scale first to avoid overflow or underflow with extreme finite inputs.
  const length = Math.hypot(w / largest, x / largest, y / largest, z / largest);
  return {
    w: w / largest / length,
    x: x / largest / length,
    y: y / largest / length,
    z: z / largest / length,
  };
}

export function createIdentityTransform(): Required<
  Pick<Transform, "position" | "rotation" | "scale">
> {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}
