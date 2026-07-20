import { packDecodedGaussianFrameForBabylon } from "./babylonPackedFrame.js";

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
