import { PackedSplats } from "@sparkjsdev/spark";

import { SparkRendererStateError } from "./errors.js";
import { fillCpuSortKeys } from "./fillCpuSortKeys.js";
import { getSparkCpuSortSource } from "./SparkCpuSortSource.js";

import type { CpuSortKeyRequest } from "./fillCpuSortKeys.js";
import type { SparkCpuSortSource } from "./SparkCpuSortSource.js";
import type { SplatMesh, SplatMeshOptions } from "@sparkjsdev/spark";
import type { Scene } from "three";

const SH_LAYOUT = [
  { key: "sh1", level: 1, wordsPerSplat: 2 },
  { key: "sh2", level: 2, wordsPerSplat: 4 },
  { key: "sh3", level: 3, wordsPerSplat: 4 },
] as const;

export interface SparkFlatFrameDisplayOptions {
  createSplatMesh(options: SplatMeshOptions): SplatMesh;
  scene: Scene;
}

export interface SparkFlatFrameCopyResult {
  capacity: number;
  durationMs: number;
  reallocated: boolean;
  splatCount: number;
}

/**
 * Owns the single GPU-facing flat dynamic mesh. Buffered frames retain decoded CPU
 * PackedSplats; presenting one copies its attributes into this grow-only allocation.
 */
export class SparkFlatFrameDisplay {
  private capacityValue = 0;
  private cpuSortSourceValue: SparkCpuSortSource | undefined;
  private maximumSphericalHarmonicsValue = 0;
  private meshValue: SplatMesh | undefined;
  private reallocationCountValue = 0;
  private readonly options: SparkFlatFrameDisplayOptions;

  constructor(options: SparkFlatFrameDisplayOptions) {
    this.options = options;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  get mesh(): SplatMesh | undefined {
    return this.meshValue;
  }

  get reallocationCount(): number {
    return this.reallocationCountValue;
  }

  present(sourceMesh: SplatMesh, now: () => number): SparkFlatFrameCopyResult {
    const source = this.requirePackedSplats(sourceMesh, "source");
    const displayMesh = this.ensureDisplayMesh(source.maxSplats);
    const target = this.requirePackedSplats(displayMesh, "display");
    const startedAt = now();
    const previousCapacity = target.maxSplats;

    this.copyPackedSplats(source, target);
    this.cpuSortSourceValue = getSparkCpuSortSource(source);
    displayMesh.numSplats = source.numSplats;
    this.copyTransform(sourceMesh, displayMesh);
    const sphericalHarmonicsChanged =
      this.maximumSphericalHarmonicsValue !== source.getNumSh();
    this.maximumSphericalHarmonicsValue = source.getNumSh();
    const maximumChanged = displayMesh.maxSh !== sourceMesh.maxSh;
    if (maximumChanged) {
      displayMesh.maxSh = sourceMesh.maxSh;
    }
    if (maximumChanged || sphericalHarmonicsChanged) {
      displayMesh.updateGenerator();
    }
    target.setMaxSh(sourceMesh.maxSh);

    // Each independently encoded temporal frame has an unrelated splat order. Force
    // Spark to regenerate and sort it even when consecutive frames have equal counts.
    displayMesh.updateMappingVersion();
    displayMesh.opacity = 1;
    displayMesh.visible = true;

    this.capacityValue = target.maxSplats;
    const reallocated = target.maxSplats > previousCapacity;
    if (reallocated) {
      this.reallocationCountValue += 1;
    }
    return {
      capacity: target.maxSplats,
      durationMs: now() - startedAt,
      reallocated,
      splatCount: source.numSplats,
    };
  }

  hide(): void {
    if (this.meshValue !== undefined) {
      this.meshValue.visible = false;
    }
  }

  fillCpuSortKeys(request: Omit<CpuSortKeyRequest, "matrixWorld">): boolean {
    const mesh = this.meshValue;
    const source = this.cpuSortSourceValue;
    if (mesh === undefined || source === undefined || !mesh.visible) {
      return false;
    }
    mesh.updateWorldMatrix(true, false);
    return fillCpuSortKeys(source, {
      ...request,
      matrixWorld: mesh.matrixWorld.elements,
    });
  }

  updateTransform(sourceMesh: SplatMesh): void {
    if (this.meshValue !== undefined) {
      this.copyTransform(sourceMesh, this.meshValue);
      this.meshValue.updateVersion();
    }
  }

  setMaximumSphericalHarmonics(maximum: 0 | 1 | 2 | 3): void {
    const mesh = this.meshValue;
    if (mesh !== undefined && mesh.maxSh !== maximum) {
      mesh.maxSh = maximum;
      mesh.packedSplats?.setMaxSh(maximum);
      mesh.updateGenerator();
    }
  }

  dispose(): void {
    const mesh = this.meshValue;
    if (mesh === undefined) {
      return;
    }
    this.meshValue = undefined;
    this.cpuSortSourceValue = undefined;
    mesh.removeFromParent();
    mesh.dispose();
  }

  private ensureDisplayMesh(initialCapacity: number): SplatMesh {
    if (this.meshValue !== undefined) {
      return this.meshValue;
    }
    const packedSplats = new PackedSplats({ maxSplats: initialCapacity });
    const mesh = this.options.createSplatMesh({
      editable: false,
      enableLod: false,
      lod: false,
      maxSplats: initialCapacity,
      packedSplats,
      paged: false,
    });
    packedSplats.ensureSplats(initialCapacity);
    mesh.visible = false;
    this.options.scene.add(mesh);
    this.meshValue = mesh;
    this.capacityValue = mesh.packedSplats?.maxSplats ?? 0;
    return mesh;
  }

  private copyPackedSplats(source: PackedSplats, target: PackedSplats): void {
    const sourceArray = source.packedArray;
    if (sourceArray === null) {
      throw new SparkRendererStateError("Decoded flat frame has no packed splat data.");
    }
    const targetArray = target.ensureSplats(source.numSplats);
    targetArray.set(sourceArray.subarray(0, source.numSplats * 4), 0);
    target.numSplats = source.numSplats;
    if (source.splatEncoding === undefined) {
      delete target.splatEncoding;
    } else {
      target.splatEncoding = { ...source.splatEncoding };
    }
    target.needsUpdate = true;

    for (const { key, level, wordsPerSplat } of SH_LAYOUT) {
      const sourceSh = source.extra[key];
      if (!(sourceSh instanceof Uint32Array)) {
        this.removeSphericalHarmonics(target, key);
        continue;
      }
      const targetSh = target.ensureSplatsSh(level, source.numSplats);
      targetSh.set(sourceSh.subarray(0, source.numSplats * wordsPerSplat), 0);
      this.markTextureForUpload(target.extra[`${key}Texture`]);
    }
  }

  private removeSphericalHarmonics(target: PackedSplats, key: string): void {
    delete target.extra[key];
    const textureKey = `${key}Texture`;
    const textureUniform = target.extra[textureKey] as
      { value?: { dispose?(): void; needsUpdate?: boolean } } | undefined;
    textureUniform?.value?.dispose?.();
    delete target.extra[textureKey];
  }

  private markTextureForUpload(value: unknown): void {
    const textureUniform = value as { value?: { needsUpdate?: boolean } } | undefined;
    if (textureUniform?.value !== undefined) {
      textureUniform.value.needsUpdate = true;
    }
  }

  private copyTransform(source: SplatMesh, target: SplatMesh): void {
    target.position.copy(source.position);
    target.quaternion.copy(source.quaternion);
    target.scale.copy(source.scale);
    target.updateMatrix();
  }

  private requirePackedSplats(mesh: SplatMesh, role: string): PackedSplats {
    if (mesh.packedSplats === undefined) {
      throw new SparkRendererStateError(
        `Flat ${role} mesh has no PackedSplats source.`,
      );
    }
    return mesh.packedSplats;
  }
}
