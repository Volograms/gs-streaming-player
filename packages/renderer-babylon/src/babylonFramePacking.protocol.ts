import type {
  BabylonPackedFramePayload,
  BabylonNativeTexturePayload,
  BabylonTextureSize,
} from "./babylonPackedFrame.js";
import type { BabylonSpzTextureConstraints } from "./babylonSpzNativeFrame.js";
import type { DecodedGaussianFrame } from "@6g-path/gaussian-codec";
import type { GaussianCoordinateSystem } from "@6g-path/gaussian-codec";
import type { SpzStreamingDiagnostics } from "@6g-path/gaussian-codec-spz";

export interface BabylonDecodedFramePackingRequest {
  frame: DecodedGaussianFrame;
  id: number;
  nativeTextureSize?: BabylonTextureSize;
}

export interface BabylonSpzFramePackingRequest {
  constraints: BabylonSpzTextureConstraints;
  coordinateSystem: GaussianCoordinateSystem;
  id: number;
  spzBytes: ArrayBuffer;
}

export type BabylonFramePackingRequest =
  BabylonDecodedFramePackingRequest | BabylonSpzFramePackingRequest;

export interface BabylonNativeTextureFramePackingResponse {
  id: number;
  nativePayload: BabylonNativeTexturePayload;
  ok: true;
  outputAllocatedBytes?: number;
  spzDiagnostics?: SpzStreamingDiagnostics;
  temporaryAllocatedBytes?: number;
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
