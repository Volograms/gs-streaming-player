import { Entity } from "playcanvas";

import { createHeroGaussianMaterial } from "./heroGaussianMaterial.js";

import type { AppBase, ShaderMaterial } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface GaussianLook {
  color: Vec3Tuple;
  opacity: number;
  /** Sigma in the parent's units. */
  sigma: number;
  /** Per-axis multipliers on sigma, in the ellipsoid's local axes. */
  stretch?: Vec3Tuple;
}

/**
 * One enlarged 3D gaussian drawn on its 3-sigma ellipsoid with the hero gaussian shader.
 * Position and rotation belong to the caller (set them on `entity`); call {@link sync}
 * after the whole hierarchy has moved this frame so the shader's world-to-local
 * transform matches what is drawn.
 */
export class GaussianEllipsoid {
  readonly entity: Entity;
  private readonly material: ShaderMaterial;

  constructor(application: AppBase, name: string, layerId: number | undefined) {
    this.material = createHeroGaussianMaterial();
    this.entity = new Entity(name, application);
    this.entity.addComponent("render", {
      castShadows: false,
      material: this.material,
      type: "sphere",
      ...(layerId === undefined ? {} : { layers: [layerId] }),
    });
  }

  set(look: GaussianLook): void {
    const [sx, sy, sz] = look.stretch ?? [1, 1, 1];
    // The sphere primitive has radius 0.5 = 3 sigma, so its diameter is 6 sigma.
    this.entity.setLocalScale(
      6 * look.sigma * sx,
      6 * look.sigma * sy,
      6 * look.sigma * sz,
    );
    const [r, g, b] = look.color;
    this.material.setParameter("uColor", [r, g, b, 1]);
    this.material.setParameter("uOpacity", look.opacity);
    this.entity.enabled = look.opacity > 1 / 255 && look.sigma > 0;
  }

  sync(): void {
    if (!this.entity.enabled) return;
    const inverse = this.entity.getWorldTransform().clone().invert();
    this.material.setParameter("uWorldToLocal", inverse.data);
  }

  dispose(): void {
    this.entity.destroy();
    this.material.destroy();
  }
}
