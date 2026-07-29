import { describe, expect, it, vi } from "vitest";

import { GaussianFrameDecoderRegistry } from "../src/index.js";

import type { GaussianFrameDecoder } from "../src/index.js";

describe("GaussianFrameDecoderRegistry", () => {
  it("routes bytes through an explicitly registered codec", async () => {
    const decoded = {
      alphas: new Float32Array([1]),
      antialiased: false,
      codecId: "test",
      colors: new Float32Array([1, 0, 0]),
      coordinateSystem: "RUB" as const,
      numSplats: 1,
      positions: new Float32Array([0, 0, 0]),
      rotations: new Float32Array([0, 0, 0, 1]),
      scales: new Float32Array([1, 1, 1]),
      shDegree: 0,
      sphericalHarmonics: new Float32Array(),
    };
    const decode = vi.fn().mockResolvedValue(decoded);
    const decoder: GaussianFrameDecoder = { codecId: "test", decode };
    const registry = new GaussianFrameDecoderRegistry([decoder]);
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(registry.decode("test", bytes)).resolves.toBe(decoded);
    expect(decode).toHaveBeenCalledWith(bytes, undefined);
  });

  it("rejects unknown and duplicate codec identifiers", () => {
    const decoder: GaussianFrameDecoder = {
      codecId: "test",
      decode: vi.fn(),
    };
    const registry = new GaussianFrameDecoderRegistry([decoder]);

    expect(() => registry.register(decoder)).toThrow(/already registered/);
    expect(() => registry.decode("missing", new Uint8Array())).toThrow(
      /No Gaussian frame decoder/,
    );
  });
});
