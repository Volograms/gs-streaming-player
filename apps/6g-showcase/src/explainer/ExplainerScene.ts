import {
  BLEND_NONE,
  BLEND_NORMAL,
  Color,
  Entity,
  StandardMaterial,
  Texture,
} from "@6g-path/gaussian-renderer-playcanvas";

import type { ExplainerAssets } from "./explainerAssets.js";
import type { ExplainerSceneConfig } from "./explainerSceneConfig.js";
import type { ExplainerFrameState } from "./explainerState.js";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";

export interface ExplainerVisualToggles {
  counters: boolean;
  demo: boolean;
  stage: boolean;
}

const COUNTER_CANVAS = { height: 256, width: 1024 };

/**
 * PlayCanvas side of the explainer: a pedestal beside the presenter, every demo-object
 * checkpoint preloaded as a hidden static splat, and a world-space counter panel. It
 * only applies an {@link ExplainerFrameState}; all timing decisions happen upstream.
 */
export class ExplainerScene {
  private readonly adapter: PlayCanvasGaussianRendererAdapter;
  private readonly checkpointIds: ReadonlyMap<number, string>;
  private readonly config: ExplainerSceneConfig;
  private readonly counterCanvas: HTMLCanvasElement;
  private readonly counterMaterial: StandardMaterial;
  private readonly counterPanel: Entity;
  private readonly counterTexture: Texture;
  private counterKey = "";
  private disposed = false;
  private readonly pedestal: Entity;
  private readonly pedestalMaterial: StandardMaterial;
  private visibleCheckpoint: number | undefined;

  static async create(
    adapter: PlayCanvasGaussianRendererAdapter,
    assets: ExplainerAssets,
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
    return new ExplainerScene(adapter, ids, config);
  }

  private constructor(
    adapter: PlayCanvasGaussianRendererAdapter,
    checkpointIds: ReadonlyMap<number, string>,
    config: ExplainerSceneConfig,
  ) {
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

    this.counterCanvas = document.createElement("canvas");
    this.counterCanvas.width = COUNTER_CANVAS.width;
    this.counterCanvas.height = COUNTER_CANVAS.height;
    this.counterTexture = new Texture(application.graphicsDevice, COUNTER_CANVAS);
    this.counterTexture.setSource(this.counterCanvas);
    this.counterMaterial = unlitMaterial(Color.WHITE);
    this.counterMaterial.emissiveMap = this.counterTexture;
    this.counterMaterial.opacityMap = this.counterTexture;
    this.counterMaterial.opacityMapChannel = "a";
    this.counterMaterial.update();
    this.counterPanel = new Entity("explainer-counters", application);
    // Transparent meshes in the world layer are sorted with the (non-depth-writing)
    // splats and can be overdrawn by the environment; the UI layer draws after them.
    const overlayLayer = application.scene.layers.getLayerByName("UI");
    this.counterPanel.addComponent("render", {
      castShadows: false,
      material: this.counterMaterial,
      type: "box",
      ...(overlayLayer === null ? {} : { layers: [overlayLayer.id] }),
    });
    const width = config.counters.width;
    this.counterPanel.setLocalScale(
      width,
      (width * COUNTER_CANVAS.height) / COUNTER_CANVAS.width,
      0.004,
    );
    application.root.addChild(this.counterPanel);
  }

  apply(frame: ExplainerFrameState, toggles: ExplainerVisualToggles): void {
    if (this.disposed) return;
    this.applyStage(toggles.stage ? frame.stage.visibility : 0);
    this.applyDemoObject(toggles.demo ? frame.demo : undefined);
    this.applyCounters(toggles.counters ? frame.counters : undefined, frame.demo.focus);
    this.adapter.application.renderNextFrame = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.checkpointIds.values()) this.adapter.releaseObject(id);
    this.pedestal.destroy();
    this.counterPanel.destroy();
    this.pedestalMaterial.destroy();
    this.counterMaterial.destroy();
    this.counterTexture.destroy();
  }

  private applyStage(visibility: number): void {
    this.pedestal.enabled = visibility > 0.001;
    setOpacity(this.pedestalMaterial, visibility);
  }

  private applyDemoObject(demo: ExplainerFrameState["demo"] | undefined): void {
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

    const { focus, stage } = this.config;
    const blend = smootherBlend(demo.focus);
    const base = mix(this.pedestalTop(), focus.position, blend);
    const restingYaw =
      stage.yawDegrees + shortestTurn(stage.yawDegrees, focus.yawDegrees) * blend;
    const yaw = ((restingYaw + demo.yawDegrees) * Math.PI) / 180;
    const scale =
      (stage.objectScale + (focus.objectScale - stage.objectScale) * blend) *
      demo.scale;
    this.adapter.setObjectTransform(id, {
      position: { x: base[0], y: base[1], z: base[2] },
      rotation: { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 },
      scale: { x: scale, y: scale, z: scale },
    });
  }

  private pedestalTop(): Vec3Tuple {
    const { position, pedestalHeight } = this.config.stage;
    return [position[0], position[1] + pedestalHeight, position[2]];
  }

  private applyCounters(
    counters: ExplainerFrameState["counters"] | undefined,
    focusBlend: number,
  ): void {
    const lines =
      counters === undefined ? [] : [counters.iteration, counters.gaussians];
    const visible = lines.filter(({ visibility }) => visibility > 0.001);
    this.counterPanel.enabled = visible.length > 0;
    if (visible.length === 0) return;

    const { counters: layout, focus } = this.config;
    const onStage = add(this.pedestalTop(), layout.offset);
    const inFocus = add(focus.position, focus.countersOffset);
    const [x, y, z] = mix(onStage, inFocus, smootherBlend(focusBlend));
    this.counterPanel.setPosition(x, y, z);
    // Billboard about the vertical axis so the panel always faces the viewer.
    const camera = this.adapter.cameraEntity.getPosition();
    const panel = this.counterPanel.getPosition();
    this.counterPanel.lookAt(camera.x, panel.y, camera.z);
    this.counterPanel.rotateLocal(0, 180, 0);

    const key = lines
      .map(
        ({ label, value, visibility }) =>
          `${label}:${value}:${Math.round(visibility * 20)}`,
      )
      .join("|");
    if (key === this.counterKey) return;
    this.counterKey = key;
    drawCounters(this.counterCanvas, lines);
    this.counterTexture.upload();
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
  canvas: HTMLCanvasElement,
  lines: readonly { label: string; value: number; visibility: number }[],
): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const plateAlpha = Math.max(...lines.map(({ visibility }) => visibility), 0);
  context.globalAlpha = 0.55 * plateAlpha;
  context.fillStyle = "#0c0912";
  context.beginPath();
  context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 36);
  context.fill();
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
  context.globalAlpha = 1;
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
