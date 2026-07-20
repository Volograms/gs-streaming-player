import type { BabylonPackedFramePayload } from "./babylonPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface BabylonFramePackingRequest {
  frame: DecodedGaussianFrame;
  id: number;
}

export type BabylonFramePackingResponse =
  | {
      id: number;
      ok: true;
      payload: BabylonPackedFramePayload;
      workerDurationMs: number;
    }
  | { error: string; id: number; ok: false };
