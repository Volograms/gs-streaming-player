import type { SpzStreamingDiagnostics } from "./streaming.js";
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
  | {
      diagnostics: SpzStreamingDiagnostics;
      frame: DecodedGaussianFrame;
      id: number;
      ok: true;
      outputAllocatedBytes: number;
    };
