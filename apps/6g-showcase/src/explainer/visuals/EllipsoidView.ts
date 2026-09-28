import {
  Entity,
  Mesh,
  MeshInstance,
  PRIMITIVE_TRIANGLES,
  SEMANTIC_COLOR,
  SEMANTIC_NORMAL,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  Vec3,
} from "playcanvas";

import { ELLIPSOID_STRIDE } from "../explainerAssets.js";

import { createEllipsoidMaterial } from "./ellipsoidMaterial.js";
import { drawLabel, TextPanel } from "./TextPanel.js";

import type { EllipsoidState } from "../ellipsoidState.js";
import type { AppBase, ShaderMaterial } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface EllipsoidConfig {
  /** World-space offset of the label from the object's base. */
  labelOffset: Vec3Tuple;
  /** Drawn ellipsoid radius in sigmas. */
  sigmas: number;
}

/** Key light direction in the object's stage frame. */
const LIGHT = new Vec3(0.35, 0.8, 0.5).normalize();

/**
 * Beat 6: the final model's own gaussians drawn as solid ellipsoids at their real
 * position, orientation and shape, in the object's stage frame (a child of the anchor).
 */
export class EllipsoidView {
  readonly entity: Entity;
  private readonly config: EllipsoidConfig;
  private readonly label: TextPanel;
  private readonly light = new Vec3();
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  constructor(
    application: AppBase,
    ellipsoids: Float32Array,
    config: EllipsoidConfig,
    layerId: number | undefined,
  ) {
    this.config = config;
    const sphere = icosphere();
    const count = ellipsoids.length / ELLIPSOID_STRIDE;
    const vertices = sphere.positions.length / 3;
    const centres = new Float32Array(count * vertices * 3);
    const offsets = new Float32Array(count * vertices * 3);
    const normals = new Float32Array(count * vertices * 3);
    const colours = new Float32Array(count * vertices * 4);
    const delays = new Float32Array(count * vertices);
    const indices = new Uint32Array(count * sphere.indices.length);
    for (let e = 0; e < count; e += 1) {
      const base = e * ELLIPSOID_STRIDE;
      const centre = ellipsoids.subarray(base, base + 3);
      const [w, x, y, z] = ellipsoids.subarray(
        base + 3,
        base + 7,
      ) as unknown as number[];
      const sigma = ellipsoids.subarray(base + 7, base + 10);
      const rotation = rotationMatrix(w!, x!, y!, z!);
      const delay = (e * 0.6180339887) % 1;
      for (let v = 0; v < vertices; v += 1) {
        const out = e * vertices + v;
        const unit = [
          sphere.positions[v * 3]!,
          sphere.positions[v * 3 + 1]!,
          sphere.positions[v * 3 + 2]!,
        ];
        // Offset = R * (S * unit); normal = R * (S^-1 * unit).
        const scaled = unit.map((value, axis) => value * sigma[axis]! * config.sigmas);
        const inverse = unit.map((value, axis) => value / Math.max(sigma[axis]!, 1e-6));
        centres.set(centre, out * 3);
        offsets.set(multiply(rotation, scaled), out * 3);
        normals.set(normalise(multiply(rotation, inverse)), out * 3);
        colours.set(ellipsoids.subarray(base + 10, base + 13), out * 4);
        colours[out * 4 + 3] = 1;
        delays[out] = delay;
      }
      sphere.indices.forEach((index, k) => {
        indices[e * sphere.indices.length + k] = e * vertices + index;
      });
    }
    this.mesh = new Mesh(application.graphicsDevice);
    this.mesh.setPositions(centres, 3);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD0, offsets, 3);
    this.mesh.setVertexStream(SEMANTIC_NORMAL, normals, 3);
    this.mesh.setVertexStream(SEMANTIC_COLOR, colours, 4);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD1, delays, 1);
    this.mesh.setIndices(indices);
    this.mesh.update(PRIMITIVE_TRIANGLES);

    this.material = createEllipsoidMaterial();
    const instance = new MeshInstance(this.mesh, this.material);
    // Grown vertices extend past the centres the bounds were computed from.
    instance.cull = false;
    // Opaque, so it stays in the default World layer: the UI layer only has a
    // transparent pass. Writing depth there also lets splats sort around it.
    this.entity = new Entity("explainer-ellipsoids", application);
    this.entity.addComponent("render", {
      castShadows: false,
      meshInstances: [instance],
    });
    this.label = new TextPanel(
      application,
      "explainer-ellipsoids-label",
      { pixelHeight: 160, pixelWidth: 1100, worldWidth: 0.42 },
      layerId,
    );
    this.entity.enabled = false;
  }

  apply(state: EllipsoidState | undefined, viewer: { x: number; z: number }): void {
    const visible = state !== undefined && state.grow > 0.001;
    this.entity.enabled = visible;
    if (!visible) {
      this.label.hide();
      return;
    }
    this.material.setParameter("uGrow", state.grow);
    // The light follows the object, so shading stays consistent as it turns.
    this.entity.getWorldTransform().transformVector(LIGHT, this.light).normalize();
    this.material.setParameter("uLight", [this.light.x, this.light.y, this.light.z]);

    const label = state.label;
    if (label === undefined || label.visibility <= 0.001) {
      this.label.hide();
      return;
    }
    const base = this.entity.getPosition();
    const offset = this.config.labelOffset;
    this.label.place(
      [base.x + offset[0], base.y + offset[1], base.z + offset[2]],
      viewer,
    );
    drawLabel(this.label, label.text, label.visibility);
  }

  dispose(): void {
    this.entity.destroy();
    this.label.dispose();
    this.material.destroy();
    this.mesh.destroy();
  }
}

/** Unit icosphere with one subdivision (42 vertices, 80 triangles). */
function icosphere(): { indices: number[]; positions: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const points: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((point) => normalise(point));
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const known = midpoints.get(key);
    if (known !== undefined) return known;
    const [pa, pb] = [points[a]!, points[b]!];
    points.push(normalise([pa[0]! + pb[0]!, pa[1]! + pb[1]!, pa[2]! + pb[2]!]));
    midpoints.set(key, points.length - 1);
    return points.length - 1;
  };
  const indices: number[] = [];
  for (const [a, b, c] of faces as [number, number, number][]) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    indices.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { indices, positions: points.flat() };
}

function rotationMatrix(w: number, x: number, y: number, z: number): number[][] {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) =>
    row.reduce((sum, value, k) => sum + value * vector[k]!, 0),
  );
}

function normalise(vector: number[]): number[] {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}
