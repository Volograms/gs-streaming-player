import type {
  DecodedGaussianFrame,
  GaussianCoordinateSystem,
} from "@6g-path/gaussian-codec";

export interface SpzDecodeRequest {
  bytes: ArrayBuffer;
  coordinateSystem: GaussianCoordinateSystem;
  id: number;
}

export type SpzDecodeResponse =
  | { error: string; id: number; ok: false }
  | { frame: DecodedGaussianFrame; id: number; ok: true };
