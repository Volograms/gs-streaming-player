import { Entity } from "playcanvas";

import { createDensifyPatch } from "../densifyPatch.js";

import { GaussianEllipsoid } from "./GaussianEllipsoid.js";
import { drawLabel, TextPanel } from "./TextPanel.js";

import type { PatchGaussian } from "../densifyPatch.js";
import type { DensifyState } from "../densifyState.js";
import type { SparsePoints } from "../explainerAssets.js";
import type { AppBase } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface DensifyConfig {
  /** Label width in world metres (its height follows the text canvas). */
  labelWidth: number;
  /** World-space offset of the label above the patch centre. */
  labelOffset: Vec3Tuple;
  /** Patch centre in world metres; the patch turns to face the viewer. */
  position: Vec3Tuple;
  /** World metres per patch unit (the patch is authored in reconstruction metres). */
  scale: number;
}

/** 3DGS divides the scale of a split gaussian's children by 1.6. */
const SPLIT_SCALE_FACTOR = 1.6;
/** Colour the gaussians about to split are pushed towards while they "light up". */
const HIGHLIGHT: Vec3Tuple = [1, 0.93, 0.7];
/** Colour marking the faint gaussians that are about to be pruned. */
const PRUNE_MARK: Vec3Tuple = [1, 0.32, 0.28];
/** Marked faint gaussians are raised to this opacity so the viewer can find them. */
const MARKED_OPACITY = 0.55;
/** Palette colours darker than this vanish against the dark room. */
const MIN_PALETTE_LUMA = 0.3;
/** Stage-frame region the palette is sampled from: the cab and hood. */
const PALETTE_REGION = { max: [2.7, 1.7, 1], min: [1.1, 0.5, -1] } as const;

interface PatchMember {
  gaussian: GaussianEllipsoid;
  source: PatchGaussian;
}

interface SplitMember {
  children: readonly [GaussianEllipsoid, GaussianEllipsoid];
  parent: GaussianEllipsoid;
  source: PatchGaussian;
}

/**
 * Densification and pruning on one persistent patch of gaussians in the demo object's
 * colours. It is placed in world space (by default beside the presenter, opposite the
 * object) and turned towards the viewer.
 */
export class DensifyView {
  readonly entity: Entity;
  private readonly base: readonly PatchMember[];
  private readonly config: DensifyConfig;
  /** Faint gaussians in pruning order. */
  private readonly faint: readonly PatchMember[];
  private readonly label: TextPanel;
  private readonly splits: readonly SplitMember[];

  constructor(
    application: AppBase,
    config: DensifyConfig,
    points: SparsePoints,
    layerId: number | undefined,
  ) {
    this.config = config;
    this.entity = new Entity("explainer-densify", application);
    this.entity.setLocalScale(config.scale, config.scale, config.scale);
    application.root.addChild(this.entity);
    const layout = createDensifyPatch(samplePalette(points, 32));
    const make = (name: string, source: PatchGaussian) => {
      const gaussian = new GaussianEllipsoid(application, name, layerId);
      gaussian.entity.setLocalPosition(...source.position);
      gaussian.entity.setLocalEulerAngles(0, 0, (source.rotation * 180) / Math.PI);
      this.entity.addChild(gaussian.entity);
      return gaussian;
    };
    this.base = layout.gaussians
      .filter(({ role }) => role === "base")
      .map((source) => ({
        gaussian: make("explainer-patch-gaussian", source),
        source,
      }));
    this.splits = layout.gaussians
      .filter(({ role }) => role === "split")
      .map((source) => ({
        children: [
          make("explainer-patch-child", source),
          make("explainer-patch-child", source),
        ] as const,
        parent: make("explainer-patch-split", source),
        source,
      }));
    this.faint = layout.pruneOrder.map((index) => {
      const source = layout.gaussians[index]!;
      return { gaussian: make("explainer-patch-faint", source), source };
    });
    this.label = new TextPanel(
      application,
      "explainer-densify-label",
      { pixelHeight: 160, pixelWidth: 760, worldWidth: config.labelWidth },
      layerId,
    );
    this.entity.enabled = false;
  }

  apply(state: DensifyState | undefined, viewer: { x: number; z: number }): void {
    const visibility = state?.visibility ?? 0;
    this.entity.enabled = visibility > 0.001;
    if (!this.entity.enabled || state === undefined) {
      this.label.hide();
      return;
    }
    const [px, py, pz] = this.config.position;
    this.entity.setPosition(px, py, pz);
    // Face the viewer about the vertical axis; the sheet's normal is its local +Z.
    this.entity.setEulerAngles(
      0,
      (Math.atan2(viewer.x - px, viewer.z - pz) * 180) / Math.PI,
      0,
    );
    for (const { gaussian, source } of this.base) {
      gaussian.set({ ...look(source), opacity: source.opacity * visibility });
    }
    this.applySplits(state, visibility);
    // Pruned one after another: each faint gaussian fades and shrinks in its turn.
    const removed = state.pruned * this.faint.length;
    const mark = state.pruneHighlight;
    this.faint.forEach(({ gaussian, source }, order) => {
      const survival = 1 - Math.min(Math.max(removed - order, 0), 1);
      const opacity = source.opacity + (MARKED_OPACITY - source.opacity) * mark;
      gaussian.set({
        ...look(source),
        color: tint(source.color, PRUNE_MARK, 0.75 * mark),
        opacity: opacity * visibility * survival,
        sigma: source.sigma * (0.35 + 0.65 * survival),
      });
    });
    for (const gaussian of this.all()) gaussian.sync();

    const label = state.label;
    if (label === undefined || label.visibility <= 0.001) {
      this.label.hide();
      return;
    }
    const centre = this.entity.getPosition();
    const offset = this.config.labelOffset;
    this.label.place(
      [centre.x + offset[0], centre.y + offset[1], centre.z + offset[2]],
      viewer,
    );
    drawLabel(this.label, label.text, label.visibility);
  }

  dispose(): void {
    for (const gaussian of this.all()) gaussian.dispose();
    this.entity.destroy();
    this.label.dispose();
  }

  private applySplits(state: DensifyState, visibility: number): void {
    const separation = state.splitSeparation;
    const handover = smooth(separation * 1.6);
    const glow = state.splitHighlight * 0.65;
    for (const { children, parent, source } of this.splits) {
      parent.set({
        color: tint(source.color, HIGHLIGHT, glow),
        opacity:
          Math.min(1, source.opacity + 0.1 * state.splitHighlight) *
          visibility *
          (1 - handover),
        sigma: source.sigma,
        stretch: source.stretch,
      });
      // Children start inside the parent and end either side of it along its long
      // axis, which is the parent's rotated local X.
      const along = source.sigma * source.stretch[0] * (0.3 + 0.7 * separation);
      const dx = Math.cos(source.rotation) * along;
      const dy = Math.sin(source.rotation) * along;
      children.forEach((child, index) => {
        const sign = index === 0 ? -1 : 1;
        child.entity.setLocalPosition(
          source.position[0] + sign * dx,
          source.position[1] + sign * dy,
          source.position[2],
        );
        // Children are born with the parent's glow and cool to their colour, so the
        // places where splits happened stay readable.
        child.set({
          color: tint(source.color, HIGHLIGHT, glow),
          opacity: source.opacity * visibility * handover,
          sigma: source.sigma / SPLIT_SCALE_FACTOR,
          stretch: [1.25, 1, 0.35],
        });
      });
    }
  }

  private all(): GaussianEllipsoid[] {
    return [
      ...this.base.map(({ gaussian }) => gaussian),
      ...this.splits.flatMap(({ children, parent }) => [parent, ...children]),
      ...this.faint.map(({ gaussian }) => gaussian),
    ];
  }
}

function tint(color: Vec3Tuple, target: Vec3Tuple, amount: number): Vec3Tuple {
  return [
    color[0] + (target[0] - color[0]) * amount,
    color[1] + (target[1] - color[1]) * amount,
    color[2] + (target[2] - color[2]) * amount,
  ];
}

function look(source: PatchGaussian) {
  return { color: source.color, sigma: source.sigma, stretch: source.stretch };
}

/** Colours of sparse points on the demo object's cab and hood, evenly subsampled. */
function samplePalette(points: SparsePoints, count: number): Vec3Tuple[] {
  const colours: Vec3Tuple[] = [];
  for (let index = 0; index < points.count; index += 1) {
    const inside = [0, 1, 2].every((axis) => {
      const value = points.positions[index * 3 + axis]!;
      return value >= PALETTE_REGION.min[axis]! && value <= PALETTE_REGION.max[axis]!;
    });
    if (!inside) continue;
    const colour: Vec3Tuple = [
      points.colors[index * 3]! / 255,
      points.colors[index * 3 + 1]! / 255,
      points.colors[index * 3 + 2]! / 255,
    ];
    const luma = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
    if (luma >= MIN_PALETTE_LUMA) colours.push(colour);
  }
  if (colours.length === 0) return [[0.4, 0.75, 0.8]];
  if (colours.length <= count) return colours;
  return Array.from(
    { length: count },
    (_, index) => colours[Math.floor((index * colours.length) / count)]!,
  );
}

function smooth(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return t * t * (3 - 2 * t);
}
