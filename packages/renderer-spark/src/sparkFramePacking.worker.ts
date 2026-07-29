import { packDecodedGaussianFramePayload } from "./sparkPackedFrame.js";

import type {
  SparkFramePackingRequest,
  SparkFramePackingResponse,
} from "./sparkFramePacking.protocol.js";

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SparkFramePackingRequest>) => void) | null;
  postMessage(message: SparkFramePackingResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = ({ data }) => {
  const startedAt = performance.now();
  try {
    const payload = packDecodedGaussianFramePayload(data.frame);
    workerScope.postMessage(
      {
        id: data.id,
        ok: true,
        payload,
        workerDurationMs: performance.now() - startedAt,
      },
      packedPayloadTransferList(payload),
    );
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : String(error),
      id: data.id,
      ok: false,
    });
  }
};

function packedPayloadTransferList(
  payload: ReturnType<typeof packDecodedGaussianFramePayload>,
): Transferable[] {
  return [
    payload.packedArray.buffer,
    payload.sortActive.buffer,
    payload.sortCenters.buffer,
    ...(payload.sh1 === undefined ? [] : [payload.sh1.buffer]),
    ...(payload.sh2 === undefined ? [] : [payload.sh2.buffer]),
    ...(payload.sh3 === undefined ? [] : [payload.sh3.buffer]),
  ];
}

export {};
