import type { StaticSceneObject } from "@6g-path/gaussian-player";

export interface ScenePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScenePositionConfiguration {
  readonly x?: string;
  readonly y?: string;
  readonly z?: string;
}

/** Parses a configurable world-space scene offset, defaulting each axis to the origin. */
export function parseScenePosition({
  x,
  y,
  z,
}: ScenePositionConfiguration): ScenePosition {
  return {
    x: finiteNumber(x, 0),
    y: finiteNumber(y, 0),
    z: finiteNumber(z, 0),
  };
}

/** Adds a world-space offset without discarding an object's authored component transform. */
export function withScenePosition(
  transform: StaticSceneObject["transform"],
  offset: ScenePosition,
): StaticSceneObject["transform"] {
  if (offset.x === 0 && offset.y === 0 && offset.z === 0) {
    return transform;
  }
  if (transform?.matrix !== undefined) {
    throw new RangeError("Scene position cannot be combined with a matrix transform.");
  }

  return {
    ...transform,
    position: {
      x: (transform?.position?.x ?? 0) + offset.x,
      y: (transform?.position?.y ?? 0) + offset.y,
      z: (transform?.position?.z ?? 0) + offset.z,
    },
  };
}

function finiteNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
