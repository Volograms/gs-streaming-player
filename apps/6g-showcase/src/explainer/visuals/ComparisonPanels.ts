import {
  Entity,
  Mesh,
  MeshInstance,
  PIXELFORMAT_SRGBA8,
  PRIMITIVE_TRIANGLES,
  SEMANTIC_TEXCOORD0,
  Texture,
  Vec3,
} from "playcanvas";

import { createComparisonMaterial, PANEL_MODE } from "./comparisonMaterial.js";
import { drawLabel, TextPanel } from "./TextPanel.js";

import type { ComparisonState } from "../comparisonState.js";
import type { AppBase, ShaderMaterial } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface ComparisonConfig {
  /** Gap between panels, in world metres. */
  gap: number;
  /** Error scale before colour-mapping. */
  gain: number;
  /** Centre of the group of panels, in world metres; it turns to face the viewer. */
  position: Vec3Tuple;
  /** Panels side by side ("row") or one above the other ("column"). */
  stack: "column" | "row";
  /** Width of one panel in world metres; the height follows the photo. */
  width: number;
}

/** Decoded training-view images: the photo and each checkpoint's render, by iteration. */
export interface ComparisonImages {
  photo: ImageBitmap;
  renders: ReadonlyMap<number, ImageBitmap>;
}

const MODES = [PANEL_MODE.photo, PANEL_MODE.render, PANEL_MODE.error] as const;

/** Label height under each panel, in world metres. */
const LABEL_DROP = 0.032;

/**
 * Three panels facing the viewer: the real training photo, the current render
 * from the same camera, and their error. The render and error follow the checkpoint on
 * screen, so the heatmap cools as training progresses.
 */
export class ComparisonPanels {
  readonly entity: Entity;
  private readonly config: ComparisonConfig;
  private readonly height: number;
  private readonly labels: readonly TextPanel[];
  private readonly materials: readonly ShaderMaterial[];
  private readonly mesh: Mesh;
  private readonly photo: Texture;
  private readonly renders: ReadonlyMap<number, Texture>;
  private readonly scratch = new Vec3();
  private shownIteration: number | undefined;

  constructor(
    application: AppBase,
    images: ComparisonImages,
    config: ComparisonConfig,
    layerId: number | undefined,
  ) {
    this.config = config;
    this.height = (config.width * images.photo.height) / images.photo.width;
    const texture = (source: ImageBitmap) => {
      const result = new Texture(application.graphicsDevice, {
        format: PIXELFORMAT_SRGBA8,
        height: source.height,
        mipmaps: true,
        width: source.width,
      });
      // PlayCanvas uploads ImageBitmaps on both backends; its typings omit them.
      result.setSource(source as unknown as HTMLImageElement);
      return result;
    };
    this.photo = texture(images.photo);
    this.renders = new Map(
      [...images.renders].map(([iteration, image]) => [iteration, texture(image)]),
    );
    const last = [...this.renders.keys()].sort((a, b) => a - b).at(-1);
    const mask = last === undefined ? undefined : this.renders.get(last);
    if (mask === undefined)
      throw new Error("Comparison panels need at least one render.");

    this.mesh = quad(application, config.width, this.height);
    this.entity = new Entity("explainer-comparison", application);
    const layers = layerId === undefined ? {} : { layers: [layerId] };
    this.materials = MODES.map((mode, index) => {
      const material = createComparisonMaterial();
      material.setParameter("uMode", mode);
      material.setParameter("uGain", config.gain);
      material.setParameter("uPhoto", this.photo);
      material.setParameter("uMask", mask);
      material.setParameter("uRender", mask);
      const panel = new Entity("explainer-comparison-panel", application);
      panel.addComponent("render", {
        castShadows: false,
        meshInstances: [new MeshInstance(this.mesh, material)],
        ...layers,
      });
      panel.setLocalPosition(...this.slot(index), 0);
      this.entity.addChild(panel);
      return material;
    });
    this.labels = MODES.map(
      () =>
        new TextPanel(
          application,
          "explainer-comparison-label",
          { pixelHeight: 120, pixelWidth: 640, worldWidth: config.width * 0.8 },
          layerId,
        ),
    );
    this.entity.enabled = false;
    application.root.addChild(this.entity);
  }

  apply(
    state: ComparisonState | undefined,
    iteration: number | undefined,
    viewer: { x: number; z: number },
  ): void {
    const visible = state !== undefined && state.visibility > 0.001;
    this.entity.enabled = visible;
    if (!visible) {
      for (const label of this.labels) label.hide();
      return;
    }
    const [px, py, pz] = this.config.position;
    this.entity.setPosition(px, py, pz);
    const yaw = Math.atan2(viewer.x - px, viewer.z - pz);
    this.entity.setEulerAngles(0, (yaw * 180) / Math.PI, 0);
    for (const material of this.materials) {
      material.setParameter("uOpacity", state.visibility);
    }
    const render = this.nearestRender(iteration);
    if (render !== undefined && render.iteration !== this.shownIteration) {
      this.shownIteration = render.iteration;
      for (const material of this.materials)
        material.setParameter("uRender", render.texture);
    }

    const texts = [state.labels.photo, state.labels.render, state.labels.error];
    const world = this.entity.getWorldTransform();
    this.labels.forEach((label, index) => {
      const text = texts[index] ?? "";
      if (text === "") {
        label.hide();
        return;
      }
      const [x, y] = this.slot(index);
      this.scratch.set(x, y - this.height / 2 - LABEL_DROP, 0.002);
      const at = world.transformPoint(this.scratch, this.scratch);
      label.place([at.x, at.y, at.z], viewer);
      drawLabel(label, text, state.visibility);
    });
  }

  dispose(): void {
    this.entity.destroy();
    for (const label of this.labels) label.dispose();
    for (const material of this.materials) material.destroy();
    this.photo.destroy();
    for (const texture of this.renders.values()) texture.destroy();
    this.mesh.destroy();
  }

  /** Local centre of panel `index` (0 photo, 1 render, 2 error) in the group. */
  private slot(index: number): [number, number] {
    const { gap, stack, width } = this.config;
    return stack === "row"
      ? [(index - 1) * (width + gap), 0]
      : [0, (1 - index) * (this.height + gap)];
  }

  /** The render for the checkpoint on screen (or the closest earlier one). */
  private nearestRender(
    iteration: number | undefined,
  ): { iteration: number; texture: Texture } | undefined {
    const iterations = [...this.renders.keys()].sort((a, b) => a - b);
    const target = iteration ?? iterations[0];
    if (target === undefined) return undefined;
    const chosen =
      iterations.filter((value) => value <= target).at(-1) ?? iterations[0]!;
    return { iteration: chosen, texture: this.renders.get(chosen)! };
  }
}

/** A quad in the XY plane facing +Z, with image-style UVs (v = 0 at the top). */
function quad(application: AppBase, width: number, height: number): Mesh {
  const w = width / 2;
  const h = height / 2;
  const mesh = new Mesh(application.graphicsDevice);
  mesh.setPositions([-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0]);
  mesh.setVertexStream(SEMANTIC_TEXCOORD0, [0, 1, 1, 1, 1, 0, 0, 0], 2);
  mesh.setIndices([0, 1, 2, 0, 2, 3]);
  mesh.update(PRIMITIVE_TRIANGLES);
  return mesh;
}
