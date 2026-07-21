import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { describe, expect, it, vi } from "vitest";

import { BabylonGaussianRendererAdapter } from "../src/index.js";

import type { BabylonNativeTexturePayload } from "../src/index.js";
import type { GaussianSplattingMesh } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh.js";

interface NativeUploadTestAdapter {
  updateMeshFromNativeTextures(
    mesh: GaussianSplattingMesh,
    payload: BabylonNativeTexturePayload,
  ): void;
}

describe("BabylonGaussianRendererAdapter native texture upload", () => {
  it("resizes a reused sort buffer and starts Babylon's depth sort", () => {
    const calls: string[] = [];
    const reConstruct = vi.fn();
    const mesh = {
      _activeSplatRangeKey: "old-range",
      _activeSplatRanges: new Uint32Array([0, 1]),
      _activeSplatRenderCount: 1,
      _maxShDegree: 0,
      _needsRotationScaleTextures: false,
      _postToWorker: (forced?: boolean) => calls.push(`sort:${String(forced)}`),
      _shDegree: 0,
      _sortIsDirty: false,
      _splatPositions: new Float32Array(),
      _updateTextures: () => calls.push("textures"),
      _updateSplatIndexBuffer: (vertexCount: number) =>
        calls.push(`indices:${String(vertexCount)}`),
      _vertexCount: 2,
      getBoundingInfo: () => ({ reConstruct }),
      getWorldMatrix: () => Matrix.Identity(),
    } as unknown as GaussianSplattingMesh;
    const payload: BabylonNativeTexturePayload = {
      boundsMaximum: [1, 2, 3],
      boundsMinimum: [-1, -2, -3],
      centers: new Float32Array([0, 0, 0, 1]),
      colors: new Uint8Array([255, 255, 255, 255]),
      covariancesA: new Uint16Array(4),
      covariancesB: new Uint16Array(2),
      numSplats: 1,
      shDegree: 0,
      sphericalHarmonics: [],
      textureSize: { height: 1, width: 1 },
    };
    const adapter = new BabylonGaussianRendererAdapter({}) as unknown as NativeUploadTestAdapter;

    adapter.updateMeshFromNativeTextures(mesh, payload);

    expect(calls).toEqual(["indices:1", "textures", "sort:true"]);
    expect(
      (mesh as unknown as { _activeSplatRanges: Uint32Array | null })
        ._activeSplatRanges,
    ).toBeNull();
    expect(
      (mesh as unknown as { _sortIsDirty: boolean })._sortIsDirty,
    ).toBe(true);
    expect(reConstruct).toHaveBeenCalledOnce();
  });
});
