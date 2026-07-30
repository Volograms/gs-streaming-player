import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { describe, expect, it, vi } from "vitest";

import { BabylonGaussianRendererAdapter } from "../src/index.js";

import type { BabylonNativeTexturePayload } from "../src/index.js";
import type { PreparedFrame } from "@6g-path/gaussian-player";
import type { GaussianSplattingMesh } from "@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh.js";

interface NativeUploadTestAdapter {
  updateMeshFromNativeTextures(
    mesh: GaussianSplattingMesh,
    payload: BabylonNativeTexturePayload,
  ): void;
}

interface PresentationTestAdapter {
  dynamicMeshesValue: readonly [GaussianSplattingMesh, GaussianSplattingMesh];
  engineValue: { getCaps(): { maxTextureSize: number } };
  initialised: boolean;
  preparedFrames: Map<PreparedFrame, unknown>;
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

  it("does not activate a frame released during its asynchronous upload", async () => {
    const upload = deferred<void>();
    const setEnabled = vi.fn();
    const mesh = {
      isVisible: false,
      position: { set: vi.fn() },
      rotationQuaternion: undefined,
      scaling: { set: vi.fn() },
      setEnabled,
      updateDataAsync: vi.fn(async () => upload.promise),
    } as unknown as GaussianSplattingMesh;
    const standbyMesh = {
      isVisible: false,
      position: { set: vi.fn() },
      rotationQuaternion: undefined,
      scaling: { set: vi.fn() },
      setEnabled: vi.fn(),
    } as unknown as GaussianSplattingMesh;
    const frame: PreparedFrame = {
      frameIndex: 0,
      qualityLevel: 0,
      rendererResource: {},
      sequenceId: "sequence",
      source: { frameIndex: 0, timestampSeconds: 0, url: "frame.splat" },
    };
    const adapter = new BabylonGaussianRendererAdapter({});
    const internals = adapter as unknown as PresentationTestAdapter;
    internals.initialised = true;
    internals.engineValue = { getCaps: () => ({ maxTextureSize: 2048 }) };
    internals.dynamicMeshesValue = [mesh, standbyMesh];
    internals.preparedFrames.set(frame, {
      payload: {
        numSplats: 1,
        shDegree: 0,
        sphericalHarmonics: [],
        splatBuffer: new ArrayBuffer(32),
      },
      quality: {},
    });

    const presentation = adapter.presentFrame(frame);
    await Promise.resolve();
    adapter.releaseFrame(frame);
    upload.resolve();

    await expect(presentation).rejects.toThrow("no longer owned");
    expect(setEnabled).not.toHaveBeenCalledWith(true);
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
