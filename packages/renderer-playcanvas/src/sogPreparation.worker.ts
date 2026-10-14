import {
  closeSogImages,
  prepareSogImages,
  UnsupportedSogPreparation,
} from "./sog/sogPreparation.js";

import type {
  SogPreparationRequest,
  SogPreparationResponse,
} from "./sog/sogPreparation.protocol.js";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SogPreparationRequest>) => void) | null;
  postMessage(response: SogPreparationResponse, transfer?: Transferable[]): void;
};
const active = new Map<number, AbortController>();
scope.onmessage = ({ data }) => {
  if (data.type === "cancel") active.get(data.id)?.abort();
  else void prepare(data);
};

async function prepare(
  request: Extract<SogPreparationRequest, { type: "prepare" }>,
): Promise<void> {
  const controller = new AbortController();
  active.set(request.id, controller);
  const startedAt = performance.now();
  try {
    const result = await prepareSogImages(request.bytes, controller.signal);
    try {
      scope.postMessage(
        {
          id: request.id,
          ok: true,
          result,
          workerDurationMs: performance.now() - startedAt,
        },
        result.images.map(({ bitmap }) => bitmap),
      );
    } catch (error) {
      closeSogImages(result);
      if (error instanceof DOMException && error.name === "DataCloneError") {
        throw new UnsupportedSogPreparation(
          "Worker ImageBitmap transfer is unavailable.",
          true,
        );
      }
      throw error;
    }
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      unsupported: error instanceof UnsupportedSogPreparation,
      unavailable: error instanceof UnsupportedSogPreparation && error.unavailable,
    });
  } finally {
    active.delete(request.id);
  }
}
