import { BLEND_NONE, BLEND_NORMAL, Color, Entity, StandardMaterial } from "playcanvas";

import { CameraRigView } from "./visuals/CameraRigView.js";
import { ComparisonPanels } from "./visuals/ComparisonPanels.js";
import { DensifyView } from "./visuals/DensifyView.js";
import { EllipsoidView } from "./visuals/EllipsoidView.js";
import { HeroGaussianView } from "./visuals/HeroGaussianView.js";
import { ProjectionView } from "./visuals/ProjectionView.js";
import { SparseCloudView } from "./visuals/SparseCloudView.js";
import { paintPlate, TextPanel } from "./visuals/TextPanel.js";

import type { ExplainerAssets, SparsePoints } from "./explainerAssets.js";
import type { ExplainerSceneConfig } from "./explainerSceneConfig.js";
import type { ExplainerFrameState } from "./explainerState.js";
import type { ComparisonImages } from "./visuals/ComparisonPanels.js";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

/** Everything loaded before the talk starts, besides the splat checkpoints. */
export interface ExplainerResources {
  /** Beat 4 panels; undefined when the assets have no comparison view. */
  comparison: ComparisonImages | undefined;
  /** Beat 6; undefined when the assets have no ellipsoid view. */
  ellipsoids: Float32Array | undefined;
  /** Beat 7 image; undefined when the assets have no projection view. */
  projectionImage: ImageBitmap | undefined;
  sparsePoints: SparsePoints;
}

export interface ExplainerVisualToggles {
  cameras: boolean;
  cloud: boolean;
  comparison: boolean;
  counters: boolean;
  demo: boolean;
  densify: boolean;
  ellipsoids: boolean;
  hero: boolean;
  projection: boolean;
  stage: boolean;
}

/** Where the demo object (and everything expressed in its stage frame) is placed. */
interface ObjectPose {
  base: Vec3Tuple;
  /** Stage metres to world metres, before reveal scaling. */
  scale: number;
  yawDegrees: number;
}

/**
 * PlayCanvas side of the explainer: a pedestal beside the presenter, every demo-object
 * checkpoint preloaded as a hidden static splat, and a world-space counter panel. It
 * only applies an {@link ExplainerFrameState}; all timing decisions happen upstream.
 */
export class ExplainerScene {
  private readonly adapter: PlayCanvasGaussianRendererAdapter;
  /** Follows the demo object's pose; the cloud and cameras live in its stage frame. */
  private readonly anchor: Entity;
  private readonly cameraRig: CameraRigView;
  private readonly checkpointIds: ReadonlyMap<number, string>;
  /** Beat 4; absent when the assets were built without a comparison view. */
  private readonly comparison: ComparisonPanels | undefined;
  private readonly config: ExplainerSceneConfig;
  private readonly counters: TextPanel;
  private readonly densify: DensifyView;
  /** Beat 6; absent when the assets were built without an ellipsoid view. */
  private readonly ellipsoids: EllipsoidView | undefined;
  private disposed = false;
  private readonly hero: HeroGaussianView;
  /** Beat 7; absent when the assets were built without a projection view. */
  private readonly projection: ProjectionView | undefined;
  private readonly pedestal: Entity;
  private readonly pedestalMaterial: StandardMaterial;
  private readonly sparseCloud: SparseCloudView;
  private visibleCheckpoint: number | undefined;

  static async create(
    adapter: PlayCanvasGaussianRendererAdapter,
    assets: ExplainerAssets,
    resources: ExplainerResources,
    config: ExplainerSceneConfig,
    signal?: AbortSignal,
  ): Promise<ExplainerScene> {
    const ids = new Map<number, string>();
    const loaded: string[] = [];
    try {
      // Preload every checkpoint up front: nothing is fetched once the talk is running.
      await Promise.all(
        assets.checkpoints.map(async ({ iteration, url }) => {
          const id = `explainer-checkpoint-${iteration}`;
          await adapter.loadStaticObject(
            { id, url },
            signal === undefined ? {} : { signal },
          );
          loaded.push(id);
          adapter.setObjectVisibility(id, false);
          ids.set(iteration, id);
        }),
      );
    } catch (error) {
      for (const id of loaded) adapter.releaseObject(id);
      throw error;
    }
    return new ExplainerScene(adapter, ids, assets, resources, config);
  }

  private constructor(
    adapter: PlayCanvasGaussianRendererAdapter,
    checkpointIds: ReadonlyMap<number, string>,
    assets: ExplainerAssets,
    resources: ExplainerResources,
    config: ExplainerSceneConfig,
  ) {
    const { ellipsoids, projectionImage, sparsePoints } = resources;
    this.adapter = adapter;
    this.checkpointIds = checkpointIds;
    this.config = config;
    const application = adapter.application;
    const { stage } = config;

    this.pedestalMaterial = unlitMaterial(new Color(0.11, 0.1, 0.14));
    this.pedestal = new Entity("explainer-pedestal", application);
    this.pedestal.addComponent("render", {
      castShadows: false,
      material: this.pedestalMaterial,
      type: "cylinder",
    });
    this.pedestal.setLocalScale(
      stage.pedestalRadius * 2,
      stage.pedestalHeight,
      stage.pedestalRadius * 2,
    );
    this.pedestal.setPosition(
      stage.position[0],
      stage.position[1] + stage.pedestalHeight / 2,
      stage.position[2],
    );
    application.root.addChild(this.pedestal);

    // Transparent meshes in the world layer are sorted with the (non-depth-writing)
    // splats and can be overdrawn by the environment; the UI layer draws after them.
    const overlayLayer = application.scene.layers.getLayerByName("UI");
    const overlayLayerId = overlayLayer === null ? undefined : overlayLayer.id;
    this.counters = new TextPanel(
      application,
      "explainer-counters",
      { pixelHeight: 256, pixelWidth: 1024, worldWidth: config.counters.width },
      overlayLayerId,
    );

    this.anchor = new Entity("explainer-anchor", application);
    this.sparseCloud = new SparseCloudView(application, sparsePoints, overlayLayerId);
    this.cameraRig = new CameraRigView(application, assets.cameras, overlayLayerId);
    this.projection =
      assets.projectionView === undefined || projectionImage === undefined
        ? undefined
        : new ProjectionView(
            application,
            sparsePoints,
            assets.projectionView,
            projectionImage,
            config.projection,
            overlayLayerId,
          );
    this.hero = new HeroGaussianView(
      application,
      sparsePoints,
      config.hero,
      overlayLayerId,
    );
    this.anchor.addChild(this.sparseCloud.entity);
    this.anchor.addChild(this.cameraRig.entity);
    this.anchor.addChild(this.hero.entity);
    this.ellipsoids =
      ellipsoids === undefined
        ? undefined
        : new EllipsoidView(application, ellipsoids, config.ellipsoids, overlayLayerId);
    if (this.ellipsoids !== undefined) this.anchor.addChild(this.ellipsoids.entity);
    this.densify = new DensifyView(
      application,
      config.densify,
      sparsePoints,
      overlayLayerId,
    );
    this.comparison =
      resources.comparison === undefined
        ? undefined
        : new ComparisonPanels(
            application,
            resources.comparison,
            config.comparison,
            overlayLayerId,
          );
    application.root.addChild(this.anchor);
  }

  apply(frame: ExplainerFrameState, toggles: ExplainerVisualToggles): void {
    if (this.disposed) return;
    this.applyStage(toggles.stage ? frame.stage.visibility : 0);
    const pose = this.objectPose(frame.demo);
    this.anchor.setPosition(...pose.base);
    this.anchor.setEulerAngles(0, pose.yawDegrees, 0);
    this.anchor.setLocalScale(pose.scale, pose.scale, pose.scale);
    this.applyDemoObject(toggles.demo ? frame.demo : undefined, pose);
    this.sparseCloud.apply(
      toggles.cloud ? frame.cloud : { swell: frame.cloud.swell, visibility: 0 },
    );
    this.cameraRig.apply(
      toggles.cameras ? frame.cameras : { highlight: undefined, ringVisibility: 0 },
    );
    const viewer = this.adapter.cameraEntity.getPosition();
    this.hero.apply(toggles.hero ? frame.hero : undefined, viewer);
    this.densify.apply(toggles.densify ? frame.densify : undefined, viewer);
    this.comparison?.apply(
      toggles.comparison ? frame.comparison : undefined,
      frame.demo.iteration,
      viewer,
    );
    this.ellipsoids?.apply(toggles.ellipsoids ? frame.ellipsoids : undefined, viewer);
    this.projection?.apply(
      toggles.projection ? frame.projection : undefined,
      this.anchor,
      viewer,
    );
    this.applyCounters(
      toggles.counters ? frame.counters : undefined,
      frame.demo.focus,
      viewer,
    );
    this.adapter.application.renderNextFrame = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.checkpointIds.values()) this.adapter.releaseObject(id);
    this.sparseCloud.dispose();
    this.cameraRig.dispose();
    this.hero.dispose();
    this.densify.dispose();
    this.ellipsoids?.dispose();
    this.projection?.dispose();
    this.comparison?.dispose();
    this.anchor.destroy();
    this.pedestal.destroy();
    this.counters.dispose();
    this.pedestalMaterial.destroy();
  }

  private applyStage(visibility: number): void {
    this.pedestal.enabled = visibility > 0.001;
    setOpacity(this.pedestalMaterial, visibility);
  }

  private applyDemoObject(
    demo: ExplainerFrameState["demo"] | undefined,
    pose: ObjectPose,
  ): void {
    const iteration =
      demo !== undefined && demo.scale > 0.001 ? demo.iteration : undefined;
    if (iteration !== this.visibleCheckpoint) {
      const previous = this.idFor(this.visibleCheckpoint);
      if (previous !== undefined) this.adapter.setObjectVisibility(previous, false);
      const next = this.idFor(iteration);
      if (next !== undefined) this.adapter.setObjectVisibility(next, true);
      this.visibleCheckpoint = next === undefined ? undefined : iteration;
    }
    const id = this.idFor(this.visibleCheckpoint);
    if (id === undefined || demo === undefined) return;

    const yaw = (pose.yawDegrees * Math.PI) / 180;
    const scale = pose.scale * demo.scale;
    this.adapter.setObjectTransform(id, {
      position: { x: pose.base[0], y: pose.base[1], z: pose.base[2] },
      rotation: { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 },
      scale: { x: scale, y: scale, z: scale },
    });
  }

  /** Pedestal pose blended towards the close-up pose, plus any turntable rotation. */
  private objectPose(demo: ExplainerFrameState["demo"]): ObjectPose {
    const { focus, stage } = this.config;
    const blend = smootherBlend(demo.focus);
    return {
      base: mix(this.pedestalTop(), focus.position, blend),
      scale: stage.objectScale + (focus.objectScale - stage.objectScale) * blend,
      yawDegrees:
        stage.yawDegrees +
        shortestTurn(stage.yawDegrees, focus.yawDegrees) * blend +
        demo.yawDegrees,
    };
  }

  private pedestalTop(): Vec3Tuple {
    const { position, pedestalHeight } = this.config.stage;
    return [position[0], position[1] + pedestalHeight, position[2]];
  }

  private applyCounters(
    counters: ExplainerFrameState["counters"] | undefined,
    focusBlend: number,
    viewer: { x: number; z: number },
  ): void {
    const lines =
      counters === undefined ? [] : [counters.iteration, counters.gaussians];
    if (!lines.some(({ visibility }) => visibility > 0.001)) {
      this.counters.hide();
      return;
    }
    const { counters: layout, focus } = this.config;
    const onStage = add(this.pedestalTop(), layout.offset);
    const inFocus = add(focus.position, focus.countersOffset);
    this.counters.place(mix(onStage, inFocus, smootherBlend(focusBlend)), viewer);
    const key = lines
      .map(
        ({ label, value, visibility }) =>
          `${label}:${value}:${Math.round(visibility * 20)}`,
      )
      .join("|");
    this.counters.draw(key, (context, canvas) => drawCounters(context, canvas, lines));
  }

  private idFor(iteration: number | undefined): string | undefined {
    return iteration === undefined ? undefined : this.checkpointIds.get(iteration);
  }
}

type Vec3Tuple = readonly [number, number, number];

function add(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function mix(from: Vec3Tuple, to: Vec3Tuple, amount: number): Vec3Tuple {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

/** Signed degrees from one yaw to another along the shorter way round. */
function shortestTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Extra easing on top of the cue envelope so the glide starts and lands gently. */
function smootherBlend(value: number): number {
  const t = Math.min(Math.max(value, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function drawCounters(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  lines: readonly { label: string; value: number; visibility: number }[],
): void {
  paintPlate(
    context,
    canvas,
    Math.max(...lines.map(({ visibility }) => visibility), 0),
  );
  const rowHeight = canvas.height / 2;
  lines.forEach(({ label, value, visibility }, row) => {
    if (visibility <= 0.001) return;
    const baseline = rowHeight * row + rowHeight * 0.68;
    context.globalAlpha = visibility;
    context.fillStyle = "#b8b2c7";
    context.font = "500 58px 'DM Sans', system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText(label, 48, baseline);
    context.fillStyle = "#ffffff";
    context.font = "700 76px 'DM Sans', system-ui, sans-serif";
    context.textAlign = "right";
    context.fillText(value.toLocaleString("es-ES"), canvas.width - 48, baseline);
  });
}

function unlitMaterial(color: Color): StandardMaterial {
  const material = new StandardMaterial();
  material.diffuse = new Color(0, 0, 0);
  material.emissive = color;
  material.useLighting = false;
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.update();
  return material;
}

/** Blends only while fading so the settled pedestal stays an ordinary opaque mesh. */
function setOpacity(material: StandardMaterial, opacity: number): void {
  if (Math.abs(material.opacity - opacity) < 0.002) return;
  const opaque = opacity >= 0.998;
  material.opacity = opaque ? 1 : opacity;
  material.blendType = opaque ? BLEND_NONE : BLEND_NORMAL;
  material.depthWrite = opaque;
  material.update();
}
