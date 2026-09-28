import { BLEND_NORMAL, Color, Entity, StandardMaterial, Texture } from "playcanvas";

import type { AppBase } from "playcanvas";

type Vec3Tuple = readonly [number, number, number];

export interface TextPanelOptions {
  /** Canvas resolution; the panel's aspect follows it. */
  pixelHeight: number;
  pixelWidth: number;
  /** Panel width in world metres. */
  worldWidth: number;
}

/**
 * A world-space text surface drawn with the 2D canvas API. It is redrawn only when the
 * caller's content key changes, billboards about the vertical axis towards the viewer,
 * and lives in the overlay layer: transparent meshes in the world layer can otherwise be
 * painted over by the (non-depth-writing) environment splats.
 */
export class TextPanel {
  readonly entity: Entity;
  private readonly canvas: HTMLCanvasElement;
  private key: string | undefined;
  private readonly material: StandardMaterial;
  private readonly texture: Texture;

  constructor(
    application: AppBase,
    name: string,
    options: TextPanelOptions,
    layerId: number | undefined,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = options.pixelWidth;
    this.canvas.height = options.pixelHeight;
    this.texture = new Texture(application.graphicsDevice, {
      height: options.pixelHeight,
      width: options.pixelWidth,
    });
    this.texture.setSource(this.canvas);
    this.material = new StandardMaterial();
    this.material.diffuse = new Color(0, 0, 0);
    this.material.emissive = Color.WHITE;
    this.material.emissiveMap = this.texture;
    this.material.opacityMap = this.texture;
    this.material.opacityMapChannel = "a";
    this.material.useLighting = false;
    this.material.blendType = BLEND_NORMAL;
    this.material.depthWrite = false;
    this.material.update();

    this.entity = new Entity(name, application);
    this.entity.addComponent("render", {
      castShadows: false,
      material: this.material,
      type: "box",
      ...(layerId === undefined ? {} : { layers: [layerId] }),
    });
    this.entity.setLocalScale(
      options.worldWidth,
      (options.worldWidth * options.pixelHeight) / options.pixelWidth,
      0.004,
    );
    this.entity.enabled = false;
    application.root.addChild(this.entity);
  }

  /** Shows the panel at a world position, turned towards the viewer. */
  place(position: Vec3Tuple, viewer: { x: number; z: number }): void {
    this.entity.enabled = true;
    this.entity.setPosition(position[0], position[1], position[2]);
    this.entity.lookAt(viewer.x, position[1], viewer.z);
    this.entity.rotateLocal(0, 180, 0);
  }

  hide(): void {
    this.entity.enabled = false;
  }

  /** Redraws only when `key` differs from the last drawn content. */
  draw(
    key: string,
    paint: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  ): void {
    if (key === this.key) return;
    const context = this.canvas.getContext("2d");
    if (context === null) return;
    this.key = key;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    paint(context, this.canvas);
    context.globalAlpha = 1;
    this.texture.upload();
  }

  dispose(): void {
    this.entity.destroy();
    this.material.destroy();
    this.texture.destroy();
  }
}

/** A single centred label on a backing plate, faded by `visibility`. */
export function drawLabel(panel: TextPanel, text: string, visibility: number): void {
  panel.draw(`${text}:${Math.round(visibility * 20)}`, (context, canvas) => {
    paintPlate(context, canvas, visibility);
    context.globalAlpha = visibility;
    context.fillStyle = "#ffffff";
    context.font = "700 88px 'DM Sans', system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  });
}

/** Rounded dark backing plate for legibility over bright scene content. */
export function paintPlate(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  alpha: number,
): void {
  context.globalAlpha = 0.55 * alpha;
  context.fillStyle = "#0c0912";
  context.beginPath();
  context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, canvas.height * 0.14);
  context.fill();
}
