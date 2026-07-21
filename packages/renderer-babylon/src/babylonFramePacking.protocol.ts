import type {
  BabylonPackedFramePayload,
  BabylonNativeTexturePayload,
  BabylonTextureSize,
} from "./babylonPackedFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";

export interface BabylonFramePackingRequest {
  frame: DecodedGaussianFrame;
  id: number;
  nativeTextureSize?: BabylonTextureSize;
}

export interface BabylonNativeTextureFramePackingResponse {
  id: number;
  nativePayload: BabylonNativeTexturePayload;
  ok: true;
  workerDurationMs: number;
}

export type BabylonFramePackingResponse =
  | {
      id: number;
      ok: true;
      payload: BabylonPackedFramePayload;
      workerDurationMs: number;
    }
  | BabylonNativeTextureFramePackingResponse
  | { error: string; id: number; ok: false };
