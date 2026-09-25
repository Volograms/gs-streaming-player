import { normalizeRotation } from "@6g-path/shared";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

import type { Transform } from "@6g-path/shared";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

export function applyBabylonTransform(
  node: TransformNode,
  transform: Transform | undefined,
): void {
  if (transform?.matrix !== undefined) {
    const matrix = Matrix.FromArray(transform.matrix);
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    if (!matrix.decompose(scaling, rotation, position)) {
      throw new Error("Babylon could not decompose the configured transform matrix.");
    }
    node.position.copyFrom(position);
    node.scaling.copyFrom(scaling);
    node.rotationQuaternion = rotation;
    return;
  }

  const position = transform?.position;
  const scale = transform?.scale;
  const rotation = normalizeRotation(transform?.rotation);
  node.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
  node.scaling.set(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1);
  node.rotationQuaternion = new Quaternion(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  );
}
