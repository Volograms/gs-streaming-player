import { normalizeRotation } from "@6g-path/shared";

import type { Transform } from "@6g-path/shared";
import type { Object3D } from "three";

export function applyTransform(object: Object3D, transform?: Transform): void {
  if (transform?.matrix !== undefined) {
    object.matrix.fromArray([...transform.matrix]);
    object.matrixAutoUpdate = false;
    object.matrixWorldNeedsUpdate = true;
    object.updateMatrixWorld(true);
    return;
  }

  object.matrixAutoUpdate = true;
  object.position.set(
    transform?.position?.x ?? 0,
    transform?.position?.y ?? 0,
    transform?.position?.z ?? 0,
  );
  const rotation = normalizeRotation(transform?.rotation);
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  object.scale.set(
    transform?.scale?.x ?? 1,
    transform?.scale?.y ?? 1,
    transform?.scale?.z ?? 1,
  );
  object.updateMatrix();
  object.updateMatrixWorld(true);
}
