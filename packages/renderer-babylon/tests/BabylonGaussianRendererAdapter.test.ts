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
  it("advertises fused SPZ only when both direct paths are enabled", () => {
    expect(
      new BabylonGaussianRendererAdapter({}).canPrepareCompressedFrame("spz-v4"),
    ).toBe(true);
    expect(
      new BabylonGaussianRendererAdapter({
        useFusedSpzPacking: false,
      }).canPrepareCompressedFrame("spz-v4"),
    ).toBe(false);
    expect(
      new BabylonGaussianRendererAdapter({
        useNativeTexturePacking: false,
      }).canPrepareCompressedFrame("spz-v4"),
    ).toBe(false);
    expect(
      new BabylonGaussianRendererAdapter({}).canPrepareCompressedFrame("sog"),
    ).toBe(false);
  });

  it("starts exactly one explicit depth sort for a first texture upload", () => {
    const { calls, mesh } = createMesh(0, null);

    upload(mesh);

    expect(calls).toEqual(["indices:1", "textures", "sort:true"]);
  });

  it("resizes a reused sort buffer without enqueueing a second depth sort", () => {
    const { calls, mesh, reConstruct } = createMesh(2, {});

    upload(mesh);

    // Babylon's _updateTextures() posts the reused-slot sort internally. An
    // adapter-level _postToWorker() here would cause another complete sort.
    expect(calls).toEqual(["indices:1", "textures"]);
    expect(
      (mesh as unknown as { _activeSplatRanges: Uint32Array | null })
        ._activeSplatRanges,
    ).toBeNull();
    expect(reConstruct).toHaveBeenCalledOnce();
  });
});

function createMesh(
  vertexCount: number,
  covariancesATexture: object | null,
): {
  calls: string[];
  mesh: GaussianSplattingMesh;
  reConstruct: ReturnType<typeof vi.fn>;
} {
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
    _splatPositions: new Float32Array(),
    _updateTextures: () => calls.push("textures"),
    _updateSplatIndexBuffer: (count: number) => calls.push(`indices:${String(count)}`),
    _vertexCount: vertexCount,
    covariancesATexture,
    getBoundingInfo: () => ({ reConstruct }),
    getWorldMatrix: () => Matrix.Identity(),
  } as unknown as GaussianSplattingMesh;
  return { calls, mesh, reConstruct };
}

function upload(mesh: GaussianSplattingMesh): void {
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
  const adapter = new BabylonGaussianRendererAdapter(
    {},
  ) as unknown as NativeUploadTestAdapter;
  adapter.updateMeshFromNativeTextures(mesh, payload);
}
