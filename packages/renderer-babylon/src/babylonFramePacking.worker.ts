import {
  packDecodedGaussianFrameForBabylon,
  packDecodedGaussianFrameForBabylonNativeTextures,
} from "./babylonPackedFrame.js";

import type {
  BabylonFramePackingRequest,
  BabylonFramePackingResponse,
} from "./babylonFramePacking.protocol.js";

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BabylonFramePackingRequest>) => void) | null;
  postMessage(message: BabylonFramePackingResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = ({ data }) => {
  const startedAt = performance.now();
  try {
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
        [
          nativePayload.centers.buffer,
          nativePayload.covariancesA.buffer,
          nativePayload.covariancesB.buffer,
          nativePayload.colors.buffer,
          ...nativePayload.sphericalHarmonics.map(({ buffer }) => buffer),
        ],
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
};

export {};
