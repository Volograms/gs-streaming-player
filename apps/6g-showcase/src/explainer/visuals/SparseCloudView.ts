import {
  Entity,
  Mesh,
  MeshInstance,
  PRIMITIVE_TRIANGLES,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  SEMANTIC_COLOR,
} from "playcanvas";

import { createPointCloudMaterial } from "./pointCloudMaterial.js";

import type { SparsePoints } from "../explainerAssets.js";
import type { AppBase, ShaderMaterial } from "playcanvas";

export interface SparseCloudFrame {
  /** 0 hides the cloud; 1 shows it fully. */
  visibility: number;
  /** 0 = crisp SfM points, 1 = initial gaussians at their real (exaggerated) size. */
  swell: number;
}

const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1] as const;

/** The SfM sparse cloud as camera-facing quads, in stage (reconstruction) units. */
export class SparseCloudView {
  readonly entity: Entity;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  constructor(application: AppBase, points: SparsePoints, layerId: number | undefined) {
    const { count } = points;
    const centers = new Float32Array(count * 12);
    const corners = new Float32Array(count * 8);
    const colors = new Float32Array(count * 16);
    const scales = new Float32Array(count * 4);
    const indices = new Uint32Array(count * 6);
    for (let point = 0; point < count; point += 1) {
      for (let corner = 0; corner < 4; corner += 1) {
        const vertex = point * 4 + corner;
        centers.set(points.positions.subarray(point * 3, point * 3 + 3), vertex * 3);
        corners[vertex * 2] = CORNERS[corner * 2]!;
        corners[vertex * 2 + 1] = CORNERS[corner * 2 + 1]!;
        colors[vertex * 4] = points.colors[point * 3]! / 255;
        colors[vertex * 4 + 1] = points.colors[point * 3 + 1]! / 255;
        colors[vertex * 4 + 2] = points.colors[point * 3 + 2]! / 255;
        colors[vertex * 4 + 3] = 1;
        scales[vertex] = points.scales[point]!;
      }
      const base = point * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], point * 6);
    }

    this.mesh = new Mesh(application.graphicsDevice);
    this.mesh.setPositions(centers, 3);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD0, corners, 2);
    this.mesh.setVertexStream(SEMANTIC_COLOR, colors, 4);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD1, scales, 1);
    this.mesh.setIndices(indices);
    this.mesh.update(PRIMITIVE_TRIANGLES);

    this.material = createPointCloudMaterial();
    this.material.setParameter("uDotSize", 0.035);
    this.material.setParameter("uBlobSigmas", 3);
    this.material.setParameter("uMaxBlob", 0.18);
    const instance = new MeshInstance(this.mesh, this.material);
    // Billboards extend past the vertex bounds; the cloud is small, so skip culling.
    instance.cull = false;

    this.entity = new Entity("explainer-sparse-cloud", application);
    this.entity.addComponent("render", {
      castShadows: false,
      meshInstances: [instance],
      ...(layerId === undefined ? {} : { layers: [layerId] }),
    });
    this.entity.enabled = false;
  }

  apply(frame: SparseCloudFrame): void {
    const visible = frame.visibility > 0.001;
    this.entity.enabled = visible;
    if (!visible) return;
    this.material.setParameter("uOpacity", frame.visibility);
    this.material.setParameter("uSwell", frame.swell);
  }

  dispose(): void {
    this.entity.destroy();
    this.material.destroy();
    this.mesh.destroy();
  }
}
