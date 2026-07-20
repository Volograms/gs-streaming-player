import { describe, expect, it } from "vitest";

import { readSpzV4Header, SPZ_V4_CODEC_ID } from "../src/index.js";

describe("readSpzV4Header", () => {
  it("reads the plaintext v4 header without invoking the decoder", () => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x5053474e, true);
    view.setUint32(4, 4, true);
    view.setUint32(8, 1234, true);
    view.setUint8(12, 3);
    view.setUint8(13, 12);
    view.setUint8(14, 1);
    view.setUint8(15, 6);
    view.setUint32(16, 32, true);

    expect(readSpzV4Header(bytes)).toEqual({
      antialiased: true,
      flags: 1,
      fractionalBits: 12,
      numPoints: 1234,
      numStreams: 6,
      shDegree: 3,
      tocByteOffset: 32,
      version: 4,
    });
    expect(SPZ_V4_CODEC_ID).toBe("spz-v4");
  });

  it("does not silently accept a legacy gzip SPZ", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x1f, 0x8b]);
    expect(() => readSpzV4Header(bytes)).toThrow(/NGSP/);
  });
});
