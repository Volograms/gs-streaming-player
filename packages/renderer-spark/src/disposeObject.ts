import type { Material, Object3D, Texture } from "three";

interface DisposableGeometry {
  dispose(): void;
}

interface RenderableObject extends Object3D {
  geometry?: DisposableGeometry;
  material?: Material | Material[];
}

function isTexture(value: unknown): value is Texture {
  return (
    typeof value === "object" &&
    value !== null &&
    "isTexture" in value &&
    value.isTexture === true &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) {
      value.dispose();
    }
  }

  material.dispose();
}

export function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    const renderable = child as RenderableObject;
    renderable.geometry?.dispose();

    if (Array.isArray(renderable.material)) {
      renderable.material.forEach(disposeMaterial);
    } else if (renderable.material !== undefined) {
      disposeMaterial(renderable.material);
    }
  });
}
