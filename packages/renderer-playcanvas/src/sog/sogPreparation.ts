/** Metadata stays in PlayCanvas's native SOG representation. */
export interface SogTextureGroup {
  files: string[];
  [key: string]: unknown;
}

export interface SogMetadata {
  count: number;
  version?: number;
  means: SogTextureGroup;
  scales: SogTextureGroup;
  quats: SogTextureGroup;
  sh0: SogTextureGroup;
  shN?: SogTextureGroup;
}

export interface PreparedSogImages {
  meta: SogMetadata;
  images: { name: string; bitmap: ImageBitmap }[];
  unpackDurationMs: number;
  imageDecodeDurationMs: number;
}

export class UnsupportedSogPreparation extends Error {
  constructor(
    message: string,
    readonly unavailable = false,
  ) {
    super(message);
  }
}

interface ZipEntry {
  data: Uint8Array<ArrayBuffer>;
  method: number;
  size: number;
}

const maximumEntryBytes = 256 * 1024 * 1024;

/** Read the ZIP directory without copying its embedded image payloads. */
function readZip(bytes: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(bytes);
  let end = bytes.byteLength - 22;
  const minimumEnd = Math.max(0, end - 65_535);
  while (
    end >= minimumEnd &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== bytes.byteLength)
  )
    end -= 1;
  if (end < minimumEnd) throw new Error("Invalid SOG ZIP directory.");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    count === 0xffff ||
    offset === 0xffffffff ||
    directorySize === 0xffffffff
  ) {
    throw new UnsupportedSogPreparation(
      "Multi-volume and ZIP64 SOG bundles require native loading.",
    );
  }
  if (count > 1024 || offset + directorySize > end)
    throw new Error("Invalid SOG ZIP directory bounds.");
  const directoryEnd = offset + directorySize;
  const files = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid SOG ZIP entry.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const recordSize =
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      offset + recordSize > directoryEnd ||
      local + 30 > bytes.byteLength ||
      view.getUint32(local, true) !== 0x04034b50
    )
      throw new Error("Invalid SOG ZIP entry bounds.");
    if ((flags & 1) !== 0)
      throw new UnsupportedSogPreparation("Encrypted SOG ZIP entries are unsupported.");
    const dataOffset =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataOffset + compressedSize > end || size > maximumEntryBytes)
      throw new Error("Invalid SOG ZIP payload size.");
    const name = new TextDecoder().decode(
      new Uint8Array(bytes, offset + 46, nameLength),
    );
    if (files.has(name)) throw new Error("Duplicate SOG ZIP entry.");
    files.set(name, {
      data: new Uint8Array(bytes, dataOffset, compressedSize),
      method,
      size,
    });
    offset += recordSize;
  }
  return files;
}

async function extract(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  if (entry.method === 0) {
    if (entry.data.byteLength !== entry.size)
      throw new Error("Invalid stored SOG ZIP size.");
    return entry.data;
  }
  if (entry.method !== 8 || typeof DecompressionStream !== "function") {
    throw new UnsupportedSogPreparation(
      "This SOG ZIP compression requires native loading.",
    );
  }
  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream("deflate-raw");
  } catch {
    throw new UnsupportedSogPreparation(
      "Worker ZIP deflate support is unavailable.",
      true,
    );
  }
  const reader = new Blob([entry.data]).stream().pipeThrough(decompressor).getReader();
  const result = new Uint8Array(entry.size);
  let offset = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > result.byteLength)
        throw new Error("SOG ZIP entry exceeds its declared size.");
      result.set(next.value, offset);
      offset += next.value.byteLength;
    }
    if (offset !== result.byteLength) throw new Error("Truncated SOG ZIP entry.");
    return result;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function readSogMetadata(value: unknown): SogMetadata {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid SOG metadata.");
  const meta = value as SogMetadata;
  if (!Number.isSafeInteger(meta.count) || meta.count < 0)
    throw new Error("Invalid SOG splat count.");
  if (meta.version !== undefined && meta.version !== 1 && meta.version !== 2) {
    throw new UnsupportedSogPreparation("This SOG version requires native loading.");
  }
  for (const [key, count] of [
    ["means", 2],
    ["scales", 1],
    ["quats", 1],
    ["sh0", 1],
    ["shN", 2],
  ] as const) {
    const group = meta[key];
    if (key === "shN" && (group === undefined || group === null)) continue;
    if (
      !Array.isArray(group?.files) ||
      (group.files.length !== count && !(key === "shN" && group.files.length === 0)) ||
      !group.files.every((name) => typeof name === "string" && name.length > 0)
    ) {
      throw new Error(`Invalid SOG ${key} image list.`);
    }
  }
  return meta;
}

export function closeSogImages(result: Pick<PreparedSogImages, "images">): void {
  for (const { bitmap } of result.images) bitmap.close();
}

/** Runs entirely in a worker, including Blob creation and browser image decode. */
export async function prepareSogImages(
  bytes: ArrayBuffer,
  signal: AbortSignal,
): Promise<PreparedSogImages> {
  if (typeof createImageBitmap !== "function") {
    throw new UnsupportedSogPreparation(
      "ImageBitmap decoding is unavailable in this worker.",
      true,
    );
  }
  signal.throwIfAborted();
  const startedAt = performance.now();
  const files = readZip(bytes);
  const metadata = files.get("meta.json");
  if (metadata === undefined || metadata.size > 1024 * 1024)
    throw new Error("Missing or oversized SOG metadata.");
  const meta = readSogMetadata(
    JSON.parse(new TextDecoder().decode(await extract(metadata))),
  );
  const names = [
    ...new Set(
      [meta.means, meta.scales, meta.quats, meta.sh0, meta.shN].flatMap(
        (group) => group?.files ?? [],
      ),
    ),
  ];
  const entries = names.map((name) => {
    const entry = files.get(name);
    if (entry === undefined)
      throw new UnsupportedSogPreparation(
        "SOG external images require native loading.",
      );
    return { name, entry };
  });
  // Wait for all decompressions even on failure, so a released worker slot never
  // leaves untracked inflate work running behind the next preparation.
  const extracted = await Promise.allSettled(
    entries.map(async ({ name, entry }) => ({ name, bytes: await extract(entry) })),
  );
  const extractionFailure = extracted.find((result) => result.status === "rejected");
  if (extractionFailure !== undefined) throw extractionFailure.reason;
  const payloads = extracted.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  signal.throwIfAborted();
  const unpackedAt = performance.now();
  const results = await Promise.allSettled(
    payloads.map(async ({ name, bytes: imageBytes }) => ({
      name,
      bitmap: await createImageBitmap(new Blob([imageBytes]), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      }),
    })),
  );
  const images = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = results.find((result) => result.status === "rejected");
  if (signal.aborted || failed !== undefined) {
    closeSogImages({ images });
    signal.throwIfAborted();
    throw failed!.reason;
  }
  return {
    meta,
    images,
    unpackDurationMs: unpackedAt - startedAt,
    imageDecodeDurationMs: performance.now() - unpackedAt,
  };
}
