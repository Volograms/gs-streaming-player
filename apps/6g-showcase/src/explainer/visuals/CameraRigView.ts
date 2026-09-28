import {
  BLEND_NORMAL,
  Color,
  Entity,
  Mat4,
  Mesh,
  MeshInstance,
  PRIMITIVE_LINES,
  Quat,
  StandardMaterial,
  Vec3,
} from "playcanvas";

import type { StageCameraSet } from "../explainerAssets.js";
import type { AppBase } from "playcanvas";

export interface CameraRigFrame {
  /** Visibility of the ring of all capture cameras. */
  ringVisibility: number;
  /** Index into the camera list, shown emphasised while its visibility is above 0. */
  highlight: { camera: number; visibility: number } | undefined;
}

/** Frustum depth in stage (reconstruction) metres. */
const FRUSTUM_DEPTH = 0.55;

/**
 * Wireframe frusta at the real capture poses: a faint ring of every selected camera, and
 * one emphasised frustum used when the talk focuses on a single training view.
 */
export class CameraRigView {
  readonly entity: Entity;
  private readonly highlightEntity: Entity;
  private readonly highlightMaterial: StandardMaterial;
  private readonly highlightMesh: Mesh;
  private highlightedCamera: number | undefined;
  private readonly ringEntity: Entity;
  private readonly ringMaterial: StandardMaterial;
  private readonly ringMesh: Mesh;
  private readonly cameras: StageCameraSet;
  private readonly application: AppBase;

  constructor(
    application: AppBase,
    cameras: StageCameraSet,
    layerId: number | undefined,
  ) {
    this.application = application;
    this.cameras = cameras;
    const layers = layerId === undefined ? {} : { layers: [layerId] };
    this.entity = new Entity("explainer-camera-rig", application);

    this.ringMesh = linesMesh(
      application,
      cameras.cameras.flatMap((_, index) => frustumLines(cameras, index)),
    );
    this.ringMaterial = lineMaterial(new Color(0.62, 0.78, 1));
    this.ringEntity = new Entity("explainer-camera-ring", application);
    this.ringEntity.addComponent("render", {
      castShadows: false,
      meshInstances: [new MeshInstance(this.ringMesh, this.ringMaterial)],
      ...layers,
    });
    this.entity.addChild(this.ringEntity);

    this.highlightMesh = linesMesh(application, frustumLines(cameras, 0));
    this.highlightMaterial = lineMaterial(new Color(1, 0.72, 0.28));
    this.highlightEntity = new Entity("explainer-camera-highlight", application);
    this.highlightEntity.addComponent("render", {
      castShadows: false,
      meshInstances: [new MeshInstance(this.highlightMesh, this.highlightMaterial)],
      ...layers,
    });
    this.entity.addChild(this.highlightEntity);
    this.entity.enabled = false;
  }

  apply(frame: CameraRigFrame): void {
    // Decide visibility up front: an entity's `enabled` getter also reflects its
    // parent, so reading it back after toggling a child under a disabled parent fails.
    const highlight = frame.highlight?.visibility ?? 0;
    const showRing = frame.ringVisibility > 0.001;
    const showHighlight = frame.highlight !== undefined && highlight > 0.001;
    this.entity.enabled = showRing || showHighlight;
    this.ringEntity.enabled = showRing;
    this.highlightEntity.enabled = showHighlight;
    if (showRing) setOpacity(this.ringMaterial, 0.55 * frame.ringVisibility);
    if (showHighlight && frame.highlight !== undefined) {
      if (frame.highlight.camera !== this.highlightedCamera) {
        this.highlightedCamera = frame.highlight.camera;
        this.highlightMesh.setPositions(
          frustumLines(this.cameras, frame.highlight.camera),
        );
        this.highlightMesh.update(PRIMITIVE_LINES);
      }
      setOpacity(this.highlightMaterial, highlight);
    }
    this.application.renderNextFrame = true;
  }

  dispose(): void {
    this.entity.destroy();
    for (const resource of [
      this.ringMaterial,
      this.highlightMaterial,
      this.ringMesh,
      this.highlightMesh,
    ]) {
      resource.destroy();
    }
  }
}

/** Apex-to-corner edges and the far rectangle of one frustum, as line-list positions. */
export function frustumLines(cameras: StageCameraSet, index: number): number[] {
  const camera = cameras.cameras[index];
  if (camera === undefined) throw new RangeError(`No capture camera ${index}.`);
  const [w, x, y, z] = camera.rotation;
  const pose = new Mat4().setTRS(
    new Vec3(...camera.position),
    new Quat(x, y, z, w),
    Vec3.ONE,
  );
  const halfHeight =
    FRUSTUM_DEPTH * Math.tan((cameras.verticalFovDegrees * Math.PI) / 360);
  const halfWidth = halfHeight * cameras.aspect;
  const apex = pose.transformPoint(Vec3.ZERO, new Vec3());
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ].map(([cx, cy]) =>
    pose.transformPoint(new Vec3(cx, cy, -FRUSTUM_DEPTH), new Vec3()),
  );
  const lines: Vec3[] = [];
  corners.forEach((corner, i) =>
    lines.push(apex, corner, corner, corners[(i + 1) % 4]!),
  );
  return lines.flatMap((point) => [point.x, point.y, point.z]);
}

function linesMesh(application: AppBase, positions: number[]): Mesh {
  const mesh = new Mesh(application.graphicsDevice);
  mesh.setPositions(positions);
  mesh.update(PRIMITIVE_LINES);
  return mesh;
}

function lineMaterial(color: Color): StandardMaterial {
  const material = new StandardMaterial();
  material.diffuse = new Color(0, 0, 0);
  material.emissive = color;
  material.useLighting = false;
  material.blendType = BLEND_NORMAL;
  material.depthWrite = false;
  material.update();
  return material;
}

function setOpacity(material: StandardMaterial, opacity: number): void {
  if (Math.abs(material.opacity - opacity) < 0.002) return;
  material.opacity = opacity;
  material.update();
}
