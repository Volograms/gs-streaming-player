import {
  Color,
  Entity,
  StandardMaterial,
  Texture,
  Vec3,
} from "@6g-path/gaussian-renderer-playcanvas";

import type { GaussianStreamingPlayerSnapshot } from "@6g-path/gaussian-player";
import type { PlayCanvasGaussianRendererAdapter } from "@6g-path/gaussian-renderer-playcanvas";
import type { XrInput, XrInputSource } from "@6g-path/gaussian-renderer-playcanvas";

export interface XrTransportActions {
  getSnapshot(): Readonly<GaussianStreamingPlayerSnapshot> | undefined;
  recenter(): void;
  seek(timeSeconds: number): void;
  setMuted(muted: boolean): void;
  togglePlayback(): void;
}

interface InputState {
  facePrimary: boolean;
  faceSecondary: boolean;
  seekDirection: number;
}

/** Lightweight renderer-native transport surface for controller rays and hand select. */
export class XrTransportPanel {
  private readonly actions: XrTransportActions;
  private readonly adapter: PlayCanvasGaussianRendererAdapter;
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;
  private readonly inputState = new Map<number, InputState>();
  private readonly material: StandardMaterial;
  private readonly panel: Entity;
  private readonly selectListener: (source: XrInputSource) => void;
  private readonly texture: Texture;
  private readonly updateListener: () => void;
  private visible = true;
  private readonly xrInput: XrInput;

  constructor(adapter: PlayCanvasGaussianRendererAdapter, actions: XrTransportActions) {
    this.adapter = adapter;
    this.actions = actions;
    const xrInput = adapter.application.xr?.input;
    if (xrInput === undefined) {
      throw new Error("PlayCanvas XR input is unavailable.");
    }
    this.xrInput = xrInput;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1024;
    this.canvas.height = 320;
    this.texture = new Texture(adapter.application.graphicsDevice, {
      height: this.canvas.height,
      width: this.canvas.width,
    });
    this.texture.setSource(this.canvas);
    this.material = new StandardMaterial();
    this.material.diffuseMap = this.texture;
    this.material.emissiveMap = this.texture;
    this.material.emissive = Color.WHITE;
    this.material.useLighting = false;
    this.material.update();

    this.panel = new Entity("xr-transport-panel", adapter.application);
    this.panel.addComponent("render", { material: this.material, type: "box" });
    this.panel.setLocalScale(1.42, 0.44, 0.025);
    adapter.application.root.addChild(this.panel);
    this.recenter();
    this.redraw();

    this.selectListener = (source) => this.handleSelect(source);
    this.updateListener = () => this.updateControllerShortcuts();
    this.xrInput.on("select", this.selectListener);
    adapter.application.on("update", this.updateListener);
  }

  recenter(): void {
    const camera = this.adapter.cameraEntity;
    const cameraPosition = camera.getPosition().clone();
    const panelPosition = cameraPosition
      .clone()
      .add(camera.forward.clone().mulScalar(1.2));
    panelPosition.y -= 0.32;
    this.panel.setPosition(panelPosition);
    this.panel.lookAt(cameraPosition);
    this.panel.rotateLocal(0, 180, 0);
    this.actions.recenter();
  }

  update(): void {
    this.redraw();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.xrInput.off("select", this.selectListener);
    this.adapter.application.off("update", this.updateListener);
    this.panel.destroy();
    this.material.destroy();
    this.texture.destroy();
    this.inputState.clear();
  }

  private handleSelect(source: XrInputSource): void {
    const hit = this.hitPanel(source);
    if (hit === undefined) {
      this.actions.togglePlayback();
      return;
    }
    const snapshot = this.actions.getSnapshot();
    if (snapshot === undefined) {
      return;
    }
    if (hit.y < -0.08) {
      const ratio = Math.min(1, Math.max(0, hit.x + 0.5));
      this.actions.seek(ratio * snapshot.durationSeconds);
      return;
    }
    const control = Math.floor((hit.x + 0.5) * 5);
    if (control === 0) {
      this.actions.seek(snapshot.currentTimeSeconds - 5);
    } else if (control === 1) {
      this.actions.togglePlayback();
    } else if (control === 2) {
      this.actions.seek(snapshot.currentTimeSeconds + 5);
    } else if (control === 3) {
      this.actions.setMuted(!snapshot.audio.muted);
    } else {
      this.recenter();
    }
  }

  private hitPanel(source: XrInputSource): { x: number; y: number } | undefined {
    const inverse = this.panel.getWorldTransform().clone().invert();
    const origin = inverse.transformPoint(source.getOrigin(), new Vec3());
    const direction = inverse.transformVector(source.getDirection(), new Vec3());
    if (Math.abs(direction.z) < 1e-5) {
      return undefined;
    }
    const distance = -origin.z / direction.z;
    if (distance < 0) {
      return undefined;
    }
    const x = origin.x + direction.x * distance;
    const y = origin.y + direction.y * distance;
    return Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 ? { x, y } : undefined;
  }

  private updateControllerShortcuts(): void {
    for (const source of this.xrInput.inputSources) {
      const gamepad = source.gamepad;
      if (
        gamepad === null ||
        !source.profiles.some((profile) => profile.includes("oculus-touch"))
      ) {
        continue;
      }
      const previous = this.inputState.get(source.id) ?? {
        facePrimary: false,
        faceSecondary: false,
        seekDirection: 0,
      };
      const facePrimary = gamepad.buttons[4]?.pressed ?? false;
      const faceSecondary = gamepad.buttons[5]?.pressed ?? false;
      const horizontal = gamepad.axes.at(-2) ?? 0;
      const seekDirection = horizontal < -0.75 ? -1 : horizontal > 0.75 ? 1 : 0;
      if (facePrimary && !previous.facePrimary) {
        this.actions.togglePlayback();
      }
      if (faceSecondary && !previous.faceSecondary) {
        this.visible = !this.visible;
        this.panel.enabled = this.visible;
      }
      if (seekDirection !== 0 && previous.seekDirection === 0) {
        const current = this.actions.getSnapshot()?.currentTimeSeconds ?? 0;
        this.actions.seek(current + seekDirection * 5);
      }
      this.inputState.set(source.id, {
        facePrimary,
        faceSecondary,
        seekDirection,
      });
    }
  }

  private redraw(): void {
    const context = this.canvas.getContext("2d");
    const snapshot = this.actions.getSnapshot();
    if (context === null) {
      return;
    }
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = "rgba(5, 17, 15, 0.96)";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.strokeStyle = "rgba(137, 255, 199, 0.35)";
    context.lineWidth = 3;
    context.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
    const labels = [
      "−5 SEC",
      snapshot?.isPlaying ? "PAUSE" : "PLAY",
      "+5 SEC",
      snapshot?.audio.muted ? "UNMUTE" : "MUTE",
      "CENTER",
    ];
    context.font = "600 34px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    labels.forEach((label, index) => {
      const x = (index + 0.5) * (this.canvas.width / 5);
      context.fillStyle = index === 1 ? "#8fffc7" : "#ecfff7";
      context.fillText(label, x, 100);
    });
    const current = snapshot?.currentTimeSeconds ?? 0;
    const duration = snapshot?.durationSeconds ?? 1;
    const ratio = Math.min(1, current / Math.max(duration, 0.001));
    context.fillStyle = "rgba(236, 255, 247, 0.16)";
    context.fillRect(48, 220, this.canvas.width - 96, 24);
    context.fillStyle = "#8fffc7";
    context.fillRect(48, 220, (this.canvas.width - 96) * ratio, 24);
    context.fillStyle = "#b8cbc4";
    context.font = "500 25px system-ui, sans-serif";
    context.fillText(
      `${formatTime(current)} / ${formatTime(duration)}`,
      this.canvas.width / 2,
      284,
    );
    this.texture.setSource(this.canvas);
  }
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
