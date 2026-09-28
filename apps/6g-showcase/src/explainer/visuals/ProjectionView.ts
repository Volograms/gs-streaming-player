import {
  BLEND_NONE,
  BLEND_NORMAL,
  Color,
  Entity,
  Mesh,
  MeshInstance,
  PIXELFORMAT_SRGBA8,
  PRIMITIVE_TRIANGLES,
  SEMANTIC_COLOR,
  SEMANTIC_TEXCOORD0,
  SEMANTIC_TEXCOORD1,
  SEMANTIC_TEXCOORD2,
  SEMANTIC_TEXCOORD3,
  StandardMaterial,
  Texture,
} from "playcanvas";

import { createProjectionLayout } from "../projectionLayout.js";

import { createProjectionMaterial } from "./projectionMaterial.js";
import { drawLabel, TextPanel } from "./TextPanel.js";

import type {
  ProjectionView as ProjectionViewAsset,
  SparsePoints,
} from "../explainerAssets.js";
import type { ProjectionState } from "../projectionState.js";
import type { AppBase, ShaderMaterial } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface ProjectionConfig {
  /** World-space offset of the label above the screen centre. */
  labelOffset: Vec3Tuple;
  /** Screen centre in world metres; the screen turns to face the viewer. */
  position: Vec3Tuple;
  /** Where the finished image is brought for a closer look, and its size there. */
  presentPosition: Vec3Tuple;
  presentScale: number;
  /** Screen width in world metres; its height follows the rendered image's aspect. */
  width: number;
}

const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1] as const;
const BEZEL = 0.025;

/** The image resolves over the landed splats across this part of the beat. */
const IMAGE_FADE = { end: 0.68, start: 0.52 } as const;

/**
 * Beat 7: gaussians sampled from the object fly onto a screen and flatten into 2D
 * splats where their part of the object is in the image, then the full render of the
 * final model (every gaussian, from the offline projection view) resolves over them.
 * The splats are one mesh (camera-facing quads that turn into discs on the screen),
 * drawn far to near like a splat rasteriser.
 */
export class ProjectionView {
  readonly entity: Entity;
  private readonly bezelMaterial: StandardMaterial;
  private readonly config: ProjectionConfig;
  private readonly image: Entity;
  private readonly imageMaterial: StandardMaterial;
  private readonly imageTexture: Texture;
  private readonly label: TextPanel;
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;
  private readonly screen: Entity;
  private readonly splats: Entity;

  constructor(
    application: AppBase,
    points: SparsePoints,
    view: ProjectionViewAsset,
    picture: ImageBitmap,
    config: ProjectionConfig,
    layerId: number | undefined,
  ) {
    this.config = config;
    const width = config.width;
    const height = (width * view.height) / view.width;
    const layout = createProjectionLayout(points, view, {
      halfHeight: height / 2,
      halfWidth: width / 2,
    });
    const { count } = layout;
    const starts = new Float32Array(count * 12);
    const corners = new Float32Array(count * 8);
    const targets = new Float32Array(count * 8);
    const sizes = new Float32Array(count * 8);
    const delays = new Float32Array(count * 4);
    const colors = new Float32Array(count * 16);
    const indices = new Uint32Array(count * 6);
    for (let i = 0; i < count; i += 1) {
      for (let corner = 0; corner < 4; corner += 1) {
        const vertex = i * 4 + corner;
        starts.set(layout.starts.subarray(i * 3, i * 3 + 3), vertex * 3);
        corners[vertex * 2] = CORNERS[corner * 2]!;
        corners[vertex * 2 + 1] = CORNERS[corner * 2 + 1]!;
        targets.set(layout.targets.subarray(i * 2, i * 2 + 2), vertex * 2);
        sizes[vertex * 2] = layout.radii3d[i]!;
        sizes[vertex * 2 + 1] = layout.radii2d[i]!;
        delays[vertex] = layout.delays[i]!;
        colors.set(layout.colors.subarray(i * 3, i * 3 + 3), vertex * 4);
        colors[vertex * 4 + 3] = 1;
      }
      const base = i * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
    }
    this.mesh = new Mesh(application.graphicsDevice);
    this.mesh.setPositions(starts, 3);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD0, corners, 2);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD1, targets, 2);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD2, sizes, 2);
    this.mesh.setVertexStream(SEMANTIC_TEXCOORD3, delays, 1);
    this.mesh.setVertexStream(SEMANTIC_COLOR, colors, 4);
    this.mesh.setIndices(indices);
    this.mesh.update(PRIMITIVE_TRIANGLES);

    this.material = createProjectionMaterial();
    const instance = new MeshInstance(this.mesh, this.material);
    // Vertices are placed in the shader; the mesh bounds mean nothing.
    instance.cull = false;
    // The overlay layer draws transparent meshes in manual order: splats, then image.
    instance.drawOrder = 1;
    this.splats = new Entity("explainer-projection-splats", application);
    this.splats.addComponent("render", {
      castShadows: false,
      meshInstances: [instance],
      ...(layerId === undefined ? {} : { layers: [layerId] }),
    });

    // The screen is an ordinary opaque mesh in the world layer (it hides the room
    // behind it); the splats in the overlay layer land just in front of it.
    this.bezelMaterial = new StandardMaterial();
    this.bezelMaterial.diffuse = new Color(0, 0, 0);
    this.bezelMaterial.emissive = new Color(0.05, 0.045, 0.07);
    this.bezelMaterial.useLighting = false;
    this.bezelMaterial.update();
    this.screen = new Entity("explainer-projection-screen", application);
    this.screen.addComponent("render", {
      castShadows: false,
      material: this.bezelMaterial,
      type: "box",
    });
    this.screen.setLocalScale(width + 2 * BEZEL, height + 2 * BEZEL, 0.01);

    // The full render, drawn over the splats once they have landed.
    this.imageTexture = new Texture(application.graphicsDevice, {
      format: PIXELFORMAT_SRGBA8,
      height: view.height,
      mipmaps: true,
      width: view.width,
    });
    // The engine uploads ImageBitmaps on both backends (HTMLImageElement fails on
    // WebGPU), but its typings for setSource do not list ImageBitmap.
    this.imageTexture.setSource(picture as unknown as HTMLImageElement);
    this.imageMaterial = new StandardMaterial();
    this.imageMaterial.diffuse = new Color(0, 0, 0);
    this.imageMaterial.emissive = Color.WHITE;
    this.imageMaterial.emissiveMap = this.imageTexture;
    this.imageMaterial.opacityMap = this.imageTexture;
    this.imageMaterial.opacityMapChannel = "a";
    this.imageMaterial.useLighting = false;
    this.imageMaterial.blendType = BLEND_NORMAL;
    this.imageMaterial.depthWrite = false;
    this.imageMaterial.update();
    this.image = new Entity("explainer-projection-image", application);
    this.image.addComponent("render", {
      castShadows: false,
      material: this.imageMaterial,
      type: "box",
      ...(layerId === undefined ? {} : { layers: [layerId] }),
    });
    for (const meshInstance of this.image.render!.meshInstances)
      meshInstance.drawOrder = 2;
    this.image.setLocalScale(width, height, 0.002);
    this.image.setLocalPosition(0, 0, 0.007);

    this.entity = new Entity("explainer-projection", application);
    this.entity.addChild(this.screen);
    this.entity.addChild(this.splats);
    this.entity.addChild(this.image);
    this.screen.setLocalPosition(0, 0, -0.006);
    application.root.addChild(this.entity);
    this.label = new TextPanel(
      application,
      "explainer-projection-label",
      { pixelHeight: 160, pixelWidth: 760, worldWidth: 0.3 },
      layerId,
    );
    this.entity.enabled = false;
  }

  apply(
    state: ProjectionState | undefined,
    anchor: Entity,
    viewer: { x: number; z: number },
  ): void {
    const visible = state !== undefined && state.visibility > 0.001;
    this.entity.enabled = visible;
    if (!visible) {
      this.label.hide();
      return;
    }
    // Glide from its first place to the front, growing on the way.
    const { position, presentPosition, presentScale } = this.config;
    const present = smoothstep(0, 1, state.present);
    const [px, py, pz] = [0, 1, 2].map(
      (axis) => position[axis]! + (presentPosition[axis]! - position[axis]!) * present,
    ) as [number, number, number];
    const scale = 1 + (presentScale - 1) * present;
    this.entity.setPosition(px, py, pz);
    this.entity.setLocalScale(scale, scale, scale);
    // The screen's front (local +Z) faces the viewer.
    this.entity.setEulerAngles(
      0,
      (Math.atan2(viewer.x - px, viewer.z - pz) * 180) / Math.PI,
      0,
    );
    setOpacity(this.bezelMaterial, state.visibility);
    this.material.setParameter("uAnchor", anchor.getWorldTransform().data);
    this.material.setParameter("uScreen", this.entity.getWorldTransform().data);
    this.material.setParameter("uProgress", state.progress);
    // As the image resolves, the landed splats hand over to it.
    const resolved = smoothstep(IMAGE_FADE.start, IMAGE_FADE.end, state.progress);
    this.material.setParameter("uOpacity", state.visibility * (1 - resolved));
    const imageOpacity = state.visibility * resolved;
    this.image.enabled = imageOpacity > 0.001;
    if (Math.abs(this.imageMaterial.opacity - imageOpacity) > 0.002) {
      this.imageMaterial.opacity = imageOpacity;
      this.imageMaterial.update();
    }

    const label = state.label;
    if (label === undefined || label.visibility <= 0.001) {
      this.label.hide();
      return;
    }
    const offset = this.config.labelOffset;
    this.label.place(
      [px + offset[0] * scale, py + offset[1] * scale, pz + offset[2] * scale],
      viewer,
    );
    drawLabel(this.label, label.text, label.visibility);
  }

  dispose(): void {
    this.entity.destroy();
    this.label.dispose();
    this.material.destroy();
    this.bezelMaterial.destroy();
    this.imageMaterial.destroy();
    this.imageTexture.destroy();
    this.mesh.destroy();
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Blends only while fading, so the settled screen is an ordinary opaque mesh. */
function setOpacity(material: StandardMaterial, opacity: number): void {
  if (Math.abs(material.opacity - opacity) < 0.002) return;
  const opaque = opacity >= 0.998;
  material.opacity = opaque ? 1 : opacity;
  material.blendType = opaque ? BLEND_NONE : BLEND_NORMAL;
  material.depthWrite = opaque;
  material.update();
}
