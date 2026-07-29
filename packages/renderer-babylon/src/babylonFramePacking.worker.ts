import {
  packDecodedGaussianFrameForBabylon,
  packDecodedGaussianFrameForBabylonNativeTextures,
} from "./babylonPackedFrame.js";
import { packSpzV4ForBabylonNativeTextures } from "./babylonSpzNativeFrame.js";

import type {
  BabylonFramePackingRequest,
  BabylonFramePackingResponse,
} from "./babylonFramePacking.protocol.js";

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BabylonFramePackingRequest>) => void) | null;
  postMessage(message: BabylonFramePackingResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = ({ data }) => {
  void pack(data);
};

async function pack(data: BabylonFramePackingRequest): Promise<void> {
  const startedAt = performance.now();
  try {
    if ("spzBytes" in data) {
      const result = await packSpzV4ForBabylonNativeTextures(
        new Uint8Array(data.spzBytes),
        data.coordinateSystem,
        data.constraints,
      );
      workerScope.postMessage(
        {
          id: data.id,
          nativePayload: result.payload,
          ok: true,
          outputAllocatedBytes: result.outputAllocatedBytes,
          spzDiagnostics: result.diagnostics,
          temporaryAllocatedBytes: result.temporaryAllocatedBytes,
          workerDurationMs: performance.now() - startedAt,
        },
        nativePayloadTransferList(result.payload),
      );
      return;
    }
    if (data.nativeTextureSize !== undefined) {
      const nativePayload = packDecodedGaussianFrameForBabylonNativeTextures(
        data.frame,
        data.nativeTextureSize,
      );
      workerScope.postMessage(
        {
          id: data.id,
          nativePayload,
          ok: true,
          workerDurationMs: performance.now() - startedAt,
        },
        nativePayloadTransferList(nativePayload),
      );
      return;
    }
    const payload = packDecodedGaussianFrameForBabylon(data.frame);
    workerScope.postMessage(
      {
        id: data.id,
        ok: true,
        payload,
        workerDurationMs: performance.now() - startedAt,
      },
      [payload.splatBuffer, ...payload.sphericalHarmonics.map(({ buffer }) => buffer)],
    );
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : String(error),
      id: data.id,
      ok: false,
    });
  }
}

function nativePayloadTransferList(
  payload: import("./babylonPackedFrame.js").BabylonNativeTexturePayload,
): Transferable[] {
  return [
    payload.centers.buffer,
    payload.covariancesA.buffer,
    payload.covariancesB.buffer,
    payload.colors.buffer,
    ...payload.sphericalHarmonics.map(({ buffer }) => buffer),
  ];
}

export {};
