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

export function createIdentityTransform(): Required<
  Pick<Transform, "position" | "rotation" | "scale">
> {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}
