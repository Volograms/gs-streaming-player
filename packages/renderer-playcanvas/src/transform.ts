import { Mat4, Quat, Vec3 } from "playcanvas";

import type { Transform } from "@6g-path/shared";
import type { Entity } from "playcanvas";

export function applyPlayCanvasTransform(
  entity: Entity,
  transform: Transform | undefined,
): void {
  if (transform?.matrix !== undefined) {
    const matrix = new Mat4().set([...transform.matrix]);
    const position = matrix.getTranslation(new Vec3());
    const scale = matrix.getScale(new Vec3());
    const rotation = new Quat().setFromMat4(matrix);
    entity.setLocalPosition(position);
    entity.setLocalRotation(rotation);
    entity.setLocalScale(scale);
    return;
  }

  entity.setLocalPosition(
    transform?.position?.x ?? 0,
    transform?.position?.y ?? 0,
    transform?.position?.z ?? 0,
  );
  entity.setLocalRotation(
    transform?.rotation?.x ?? 0,
    transform?.rotation?.y ?? 0,
    transform?.rotation?.z ?? 0,
    transform?.rotation?.w ?? 1,
  );
  entity.setLocalScale(
    transform?.scale?.x ?? 1,
    transform?.scale?.y ?? 1,
    transform?.scale?.z ?? 1,
  );
}
