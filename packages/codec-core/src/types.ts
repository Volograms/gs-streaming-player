export type GaussianCoordinateSystem =
  | "UNSPECIFIED"
  | "LDB"
  | "RDB"
  | "LUB"
  | "RUB"
  | "LDF"
  | "RDF"
  | "LUF"
  | "RUF"
  | "LFD"
  | "RFD"
  | "LFU"
  | "RFU"
  | "LBD"
  | "RBD"
  | "LBU"
  | "RBU";

/**
 * Renderer-neutral attributes. Typed-array ownership passes to the caller, so a
 * renderer adapter may transfer and detach every attribute buffer.
 */
export interface DecodedGaussianFrame {
  /** Alpha values in the inclusive range [0, 1], one per splat. */
  alphas: Float32Array;
  /** Whether the source was trained for an antialiased splat renderer. */
  antialiased: boolean;
  /** Codec implementation that produced this representation. */
  codecId: string;
  /** RGB values in the inclusive range [0, 1], three values per splat. */
  colors: Float32Array;
  coordinateSystem: GaussianCoordinateSystem;
  numSplats: number;
  /** XYZ centers, three values per splat. */
  positions: Float32Array;
  /** XYZW quaternions, four values per splat. */
  rotations: Float32Array;
  /** Positive XYZ scale values, three values per splat. */
  scales: Float32Array;
  /** Spherical-harmonic degree represented by `sphericalHarmonics`. */
  shDegree: number;
  /** Coefficient-major RGB SH data, excluding degree zero. */
  sphericalHarmonics: Float32Array;
}

export interface GaussianFrameDecodeOptions {
  /** Coordinate system requested by the consumer. */
  coordinateSystem?: GaussianCoordinateSystem;
  signal?: AbortSignal;
}

export interface GaussianFrameDecoder {
  readonly codecId: string;
  decode(
    compressedBytes: Readonly<Uint8Array>,
    options?: GaussianFrameDecodeOptions,
  ): Promise<DecodedGaussianFrame>;
  dispose?(): void;
}
