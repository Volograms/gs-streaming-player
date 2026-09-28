import {
  BLEND_NORMAL,
  Color,
  Entity,
  Mesh,
  MeshInstance,
  PRIMITIVE_LINES,
  StandardMaterial,
} from "playcanvas";

import { GaussianEllipsoid } from "./GaussianEllipsoid.js";
import { drawLabel, TextPanel } from "./TextPanel.js";

import type { SparsePoints } from "../explainerAssets.js";
import type { HeroGaussianState } from "../heroGaussianState.js";
import type { AppBase } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface HeroGaussianConfig {
  /** World-space offset of the label above the hero centre. */
  labelOffset: Vec3Tuple;
  /** Presentation position in stage (reconstruction) metres. */
  position: Vec3Tuple;
  /** Presentation sigma in stage metres (the drawn ellipsoid is 3 sigma). */
  sigma: number;
  /** Fixed tilt so stretching reads as an oriented ellipsoid, not a zoom. */
  tiltDegrees: number;
}

/**
 * Where in the cloud the hero starts: the most saturated sparse point near this stage
 * point (the cab), so its colour reads clearly and a hue shift is visible.
 */
const SOURCE_TARGET: Vec3Tuple = [1.6, 1.2, 0];
const SOURCE_SEARCH_RADIUS = 1.2;
/** Matches the cloud's swollen blob radius cap (3 sigma, stage metres). */
const MAX_SOURCE_RADIUS = 0.18;

/**
 * The hero gaussian lives in the demo object's stage frame (a child of the explainer
 * anchor), so it scales and moves with the object. Its label is world-space.
 */
export class HeroGaussianView {
  readonly entity: Entity;
  private readonly application: AppBase;
  private readonly config: HeroGaussianConfig;
  private readonly ellipsoid: GaussianEllipsoid;
  private readonly gizmo: Entity;
  private readonly gizmoMaterials: StandardMaterial[];
  private readonly gizmoMeshes: Mesh[];
  private readonly label: TextPanel;
  private readonly source: { color: Vec3Tuple; position: Vec3Tuple; sigma: number };

  /** The hero's own colour, reused by the later beats that bring it back. */
  get color(): Vec3Tuple {
    return this.source.color;
  }

  constructor(
    application: AppBase,
    points: SparsePoints,
    config: HeroGaussianConfig,
    layerId: number | undefined,
  ) {
    this.application = application;
    this.config = config;
    this.source = nearestPoint(points, SOURCE_TARGET);
    const layers = layerId === undefined ? {} : { layers: [layerId] };

    this.entity = new Entity("explainer-hero", application);
    this.ellipsoid = new GaussianEllipsoid(
      application,
      "explainer-hero-ellipsoid",
      layerId,
    );
    this.entity.addChild(this.ellipsoid.entity);

    this.gizmo = new Entity("explainer-hero-gizmo", application);
    this.gizmoMeshes = [];
    this.gizmoMaterials = [];
    const axes: [Vec3Tuple, Color][] = [
      [[1, 0, 0], new Color(1, 0.35, 0.35)],
      [[0, 1, 0], new Color(0.4, 1, 0.45)],
      [[0, 0, 1], new Color(0.4, 0.6, 1)],
    ];
    const length = config.sigma * 3 * 1.6;
    for (const [axis, color] of axes) {
      const mesh = new Mesh(application.graphicsDevice);
      mesh.setPositions([
        0,
        0,
        0,
        axis[0] * length,
        axis[1] * length,
        axis[2] * length,
      ]);
      mesh.update(PRIMITIVE_LINES);
      const material = new StandardMaterial();
      material.diffuse = new Color(0, 0, 0);
      material.emissive = color;
      material.useLighting = false;
      material.blendType = BLEND_NORMAL;
      material.depthWrite = false;
      material.update();
      const line = new Entity("explainer-hero-axis", application);
      line.addComponent("render", {
        castShadows: false,
        meshInstances: [new MeshInstance(mesh, material)],
        ...layers,
      });
      this.gizmo.addChild(line);
      this.gizmoMeshes.push(mesh);
      this.gizmoMaterials.push(material);
    }
    this.entity.addChild(this.gizmo);

    this.label = new TextPanel(
      application,
      "explainer-hero-label",
      { pixelHeight: 160, pixelWidth: 640, worldWidth: 0.24 },
      layerId,
    );
    this.entity.enabled = false;
  }

  apply(state: HeroGaussianState | undefined, viewer: { x: number; z: number }): void {
    const visible = state !== undefined && state.visibility > 0.001;
    this.entity.enabled = visible;
    if (!visible) {
      this.label.hide();
      return;
    }
    const { config, source } = this;
    const e = smootherstep(state.emergence);
    const position = mix(source.position, config.position, e);
    this.entity.setLocalPosition(
      position[0] + state.offset[0],
      position[1] + state.offset[1],
      position[2] + state.offset[2],
    );
    this.entity.setLocalEulerAngles(0, 0, config.tiltDegrees * e);

    this.ellipsoid.set({
      color: rotateHue(source.color, state.hueShift),
      opacity: 0.95 * state.visibility * state.opacity,
      sigma: source.sigma + (config.sigma - source.sigma) * e,
      stretch: state.stretch,
    });
    this.ellipsoid.sync();

    const gizmoVisible = state.gizmo > 0.001;
    this.gizmo.enabled = gizmoVisible;
    if (gizmoVisible) {
      for (const material of this.gizmoMaterials) setOpacity(material, state.gizmo);
    }

    const label = state.label;
    if (label === undefined || label.visibility <= 0.001) {
      this.label.hide();
    } else {
      const centre = this.entity.getPosition();
      this.label.place(
        [
          centre.x + config.labelOffset[0],
          centre.y + config.labelOffset[1],
          centre.z + config.labelOffset[2],
        ],
        viewer,
      );
      drawLabel(this.label, label.text, label.visibility);
    }
    this.application.renderNextFrame = true;
  }

  dispose(): void {
    this.entity.destroy();
    this.label.dispose();
    this.ellipsoid.dispose();
    for (const resource of [...this.gizmoMaterials, ...this.gizmoMeshes])
      resource.destroy();
  }
}

function nearestPoint(
  points: SparsePoints,
  target: Vec3Tuple,
): { color: Vec3Tuple; position: Vec3Tuple; sigma: number } {
  let best = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < points.count; index += 1) {
    const dx = points.positions[index * 3]! - target[0];
    const dy = points.positions[index * 3 + 1]! - target[1];
    const dz = points.positions[index * 3 + 2]! - target[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const r = points.colors[index * 3]!;
    const g = points.colors[index * 3 + 1]!;
    const b = points.colors[index * 3 + 2]!;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    // Prefer saturated points; fall back to the nearest one outside the search radius.
    const score =
      distance <= SOURCE_SEARCH_RADIUS ? chroma - distance * 0.05 : -distance;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return {
    color: [
      points.colors[best * 3]! / 255,
      points.colors[best * 3 + 1]! / 255,
      points.colors[best * 3 + 2]! / 255,
    ],
    position: [
      points.positions[best * 3]!,
      points.positions[best * 3 + 1]!,
      points.positions[best * 3 + 2]!,
    ],
    sigma: Math.min(points.scales[best]! * 3, MAX_SOURCE_RADIUS) / 3,
  };
}

/** Rotates hue by `turns` while keeping lightness and saturation (HSL). */
export function rotateHue(color: Vec3Tuple, turns: number): Vec3Tuple {
  if (turns === 0) return color;
  const [r, g, b] = color;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  // Nearly grey colours have no visible hue; give them some saturation to rotate.
  const saturation = delta < 1e-4 ? 0.6 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta >= 1e-4) {
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = (hue / 6 + turns) % 1;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * Math.min(saturation, 1);
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(hue * 6);
  const [rr, gg, bb] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector % 6]!;
  return [rr! + m, gg! + m, bb! + m];
}

function mix(from: Vec3Tuple, to: Vec3Tuple, amount: number): Vec3Tuple {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function smootherstep(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function setOpacity(material: StandardMaterial, opacity: number): void {
  if (Math.abs(material.opacity - opacity) < 0.002) return;
  material.opacity = opacity;
  material.update();
}
