import type { SparkPackedFramePayload } from "./sparkPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface SparkFramePackingRequest {
  frame: DecodedGaussianFrame;
  id: number;
}

export type SparkFramePackingResponse =
  | {
      id: number;
      ok: true;
      payload: SparkPackedFramePayload;
      workerDurationMs: number;
    }
  | {
      error: string;
      id: number;
      ok: false;
    };
