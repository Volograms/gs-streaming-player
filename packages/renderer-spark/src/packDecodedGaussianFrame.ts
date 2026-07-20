import { PackedSplats } from "@sparkjsdev/spark";

import { packDecodedGaussianFramePayload } from "./sparkPackedFrame.js";

import type { SparkPackedFramePayload } from "./sparkPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface PackedDecodedGaussianFrame {
  durationMs: number;
  packedSplats: PackedSplats;
}

export function packDecodedGaussianFrame(
  frame: Readonly<DecodedGaussianFrame>,
  now: () => number,
): PackedDecodedGaussianFrame {
  const startedAt = now();
  const packedSplats = createPackedSplatsFromPayload(
    packDecodedGaussianFramePayload(frame),
  );
  return { durationMs: now() - startedAt, packedSplats };
}

export function createPackedSplatsFromPayload(
  payload: SparkPackedFramePayload,
): PackedSplats {
  const extra: Record<string, Uint32Array> = {};
  if (payload.sh1 !== undefined) {
    extra.sh1 = payload.sh1;
  }
  if (payload.sh2 !== undefined) {
    extra.sh2 = payload.sh2;
  }
  if (payload.sh3 !== undefined) {
    extra.sh3 = payload.sh3;
  }
  const packedSplats = new PackedSplats({
    extra,
    numSplats: payload.numSplats,
    packedArray: payload.packedArray,
  });
  packedSplats.maxSh = payload.shDegree;
  packedSplats.setMaxSh(payload.shDegree);
  packedSplats.needsUpdate = true;
  return packedSplats;
}
