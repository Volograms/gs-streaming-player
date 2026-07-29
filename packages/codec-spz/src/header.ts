export const SPZ_V4_CODEC_ID = "spz-v4";
export const SPZ_V4_MAGIC = 0x5053474e;

export interface SpzV4Header {
  antialiased: boolean;
  flags: number;
  fractionalBits: number;
  numPoints: number;
  numStreams: number;
  shDegree: number;
  tocByteOffset: number;
  version: 4;
}

export function readSpzV4Header(bytes: Readonly<Uint8Array>): SpzV4Header {
  if (bytes.byteLength < 32) {
    throw new Error("SPZ v4 data is shorter than its 32-byte header.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== SPZ_V4_MAGIC) {
    throw new Error("SPZ v4 data does not start with the NGSP magic value.");
  }
  const version = view.getUint32(4, true);
  if (version !== 4) {
    throw new Error(`Expected SPZ version 4 but received version ${version}.`);
  }
  const shDegree = view.getUint8(12);
  if (shDegree > 4) {
    throw new Error(`SPZ v4 SH degree ${shDegree} is not supported.`);
  }
  const numStreams = view.getUint8(15);
  const tocByteOffset = view.getUint32(16, true);
  if (tocByteOffset < 32 || tocByteOffset > bytes.byteLength) {
    throw new Error(`SPZ v4 TOC offset ${tocByteOffset} is outside the file.`);
  }
  const flags = view.getUint8(14);
  return {
    antialiased: (flags & 1) !== 0,
    flags,
    fractionalBits: view.getUint8(13),
    numPoints: view.getUint32(8, true),
    numStreams,
    shDegree,
    tocByteOffset,
    version: 4,
  };
}
