import type {
  GaussianFrameDecodeOptions,
  GaussianFrameDecoder,
  DecodedGaussianFrame,
} from "./types.js";

export class GaussianFrameDecoderRegistry {
  private readonly decoders = new Map<string, GaussianFrameDecoder>();

  constructor(decoders: readonly GaussianFrameDecoder[] = []) {
    for (const decoder of decoders) {
      this.register(decoder);
    }
  }

  register(decoder: GaussianFrameDecoder): void {
    const codecId = decoder.codecId.trim();
    if (codecId === "") {
      throw new Error("A Gaussian frame decoder must have a non-empty codecId.");
    }
    if (this.decoders.has(codecId)) {
      throw new Error(
        `A Gaussian frame decoder is already registered for '${codecId}'.`,
      );
    }
    this.decoders.set(codecId, decoder);
  }

  has(codecId: string): boolean {
    return this.decoders.has(codecId);
  }

  decode(
    codecId: string,
    compressedBytes: Readonly<Uint8Array>,
    options?: GaussianFrameDecodeOptions,
  ): Promise<DecodedGaussianFrame> {
    const decoder = this.decoders.get(codecId);
    if (decoder === undefined) {
      throw new Error(`No Gaussian frame decoder is registered for '${codecId}'.`);
    }
    return decoder.decode(compressedBytes, options);
  }

  dispose(): void {
    for (const decoder of this.decoders.values()) {
      decoder.dispose?.();
    }
    this.decoders.clear();
  }
}
