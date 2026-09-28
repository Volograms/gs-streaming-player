import sceneDocument from "../../explainer/scene.json";

import type { ComparisonConfig } from "./visuals/ComparisonPanels.js";
import type { DensifyConfig } from "./visuals/DensifyView.js";
import type { EllipsoidConfig } from "./visuals/EllipsoidView.js";
import type { HeroGaussianConfig } from "./visuals/HeroGaussianView.js";
import type { ProjectionConfig } from "./visuals/ProjectionView.js";

type Vec3Tuple = readonly [number, number, number];

/** Placement of the explainer stage in the showcase world (Y-up, metres). */
export interface ExplainerSceneConfig {
  assetsUrl: string;
  /** Photo / render / error panels for the highlighted camera (beat 4). */
  comparison: ComparisonConfig;
  counters: { offset: Vec3Tuple; width: number };
  /** Split and prune demonstration group, in the demo object's stage frame. */
  densify: DensifyConfig;
  /** Ellipsoid view of the final model (beat 6). */
  ellipsoids: EllipsoidConfig;
  hero: HeroGaussianConfig;
  /** Screen that receives the 2D projection (beat 7), in world metres. */
  projection: ProjectionConfig;
  /** Close-up pose in front of the presenter, used while a focus cue is active. */
  focus: {
    /** Counter panel position relative to the object base at the close-up pose. */
    countersOffset: Vec3Tuple;
    objectScale: number;
    /** Object base (its ground contact centre) in world metres. */
    position: Vec3Tuple;
    yawDegrees: number;
  };
  stage: {
    /** Demo-object stage metres to world metres. */
    objectScale: number;
    /** Height of the pedestal top above the stage origin. */
    pedestalHeight: number;
    pedestalRadius: number;
    /** Stage origin on the floor, beside the presenter. */
    position: Vec3Tuple;
    /** Rotation of the stage about world +Y. */
    yawDegrees: number;
  };
}

export const explainerSceneConfig: ExplainerSceneConfig = parseExplainerSceneConfig(
  sceneDocument,
  import.meta.env.VITE_EXPLAINER_ASSETS_URL,
);

export function parseExplainerSceneConfig(
  value: unknown,
  assetsUrlOverride?: string,
): ExplainerSceneConfig {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Explainer scene config must be version 1.");
  }
  const stage = isRecord(value.stage) ? value.stage : {};
  const counters = isRecord(value.counters) ? value.counters : {};
  const focus = isRecord(value.focus) ? value.focus : {};
  const hero = isRecord(value.hero) ? value.hero : {};
  const densify = isRecord(value.densify) ? value.densify : {};
  const projection = isRecord(value.projection) ? value.projection : {};
  const ellipsoids = isRecord(value.ellipsoids) ? value.ellipsoids : {};
  const comparison = isRecord(value.comparison) ? value.comparison : {};
  const assetsUrl = assetsUrlOverride?.trim() || value.assetsUrl;
  if (typeof assetsUrl !== "string" || assetsUrl === "") {
    throw new Error("Explainer scene config needs an assetsUrl.");
  }
  return {
    assetsUrl,
    comparison: {
      gap: positive(comparison.gap, "comparison.gap"),
      gain: positive(comparison.gain, "comparison.gain"),
      position: vec3(comparison.position, "comparison.position"),
      stack: comparison.stack === "row" ? "row" : "column",
      width: positive(comparison.width, "comparison.width"),
    },
    counters: {
      offset: vec3(counters.offset, "counters.offset"),
      width: positive(counters.width, "counters.width"),
    },
    ellipsoids: {
      labelOffset: vec3(ellipsoids.labelOffset, "ellipsoids.labelOffset"),
      sigmas: positive(ellipsoids.sigmas, "ellipsoids.sigmas"),
    },
    densify: {
      labelOffset: vec3(densify.labelOffset, "densify.labelOffset"),
      position: vec3(densify.position, "densify.position"),
      scale: positive(densify.scale, "densify.scale"),
    },
    projection: {
      labelOffset: vec3(projection.labelOffset, "projection.labelOffset"),
      position: vec3(projection.position, "projection.position"),
      presentPosition: vec3(projection.presentPosition, "projection.presentPosition"),
      presentScale: positive(projection.presentScale, "projection.presentScale"),
      width: positive(projection.width, "projection.width"),
    },
    hero: {
      labelOffset: vec3(hero.labelOffset, "hero.labelOffset"),
      position: vec3(hero.position, "hero.position"),
      sigma: positive(hero.sigma, "hero.sigma"),
      tiltDegrees: finite(hero.tiltDegrees, "hero.tiltDegrees"),
    },
    focus: {
      countersOffset: vec3(focus.countersOffset, "focus.countersOffset"),
      objectScale: positive(focus.objectScale, "focus.objectScale"),
      position: vec3(focus.position, "focus.position"),
      yawDegrees: finite(focus.yawDegrees, "focus.yawDegrees"),
    },
    stage: {
      objectScale: positive(stage.objectScale, "stage.objectScale"),
      pedestalHeight: positive(stage.pedestalHeight, "stage.pedestalHeight"),
      pedestalRadius: positive(stage.pedestalRadius, "stage.pedestalRadius"),
      position: vec3(stage.position, "stage.position"),
      yawDegrees: finite(stage.yawDegrees, "stage.yawDegrees"),
    },
  };
}

function vec3(value: unknown, label: string): Vec3Tuple {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must be [x, y, z].`);
  }
  return [finite(value[0], label), finite(value[1], label), finite(value[2], label)];
}

function positive(value: unknown, label: string): number {
  const number = finite(value, label);
  if (number <= 0) throw new Error(`${label} must be positive.`);
  return number;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
