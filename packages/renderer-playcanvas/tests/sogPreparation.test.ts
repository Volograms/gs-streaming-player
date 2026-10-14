import { deflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prepareSogImages,
  readSogMetadata,
  UnsupportedSogPreparation,
} from "../src/sog/sogPreparation.js";

const names = ["means_l.webp", "means_u.webp", "scales.webp", "quats.webp", "sh0.webp"];
const meta = {
  version: 2,
  count: 1,
  means: { files: names.slice(0, 2) },
  scales: { files: [names[2]] },
  quats: { files: [names[3]] },
  sh0: { files: [names[4]] },
};
afterEach(() => vi.unstubAllGlobals());

describe("SOG worker image preparation", () => {
  it("accepts an empty frame and an empty optional SH image list", () => {
    expect(readSogMetadata({ ...meta, count: 0, shN: { files: [] } })).toMatchObject({
      count: 0,
      shN: { files: [] },
    });
    expect(readSogMetadata({ ...meta, shN: null })).toMatchObject({ shN: null });
  });
  it.each([false, true])(
    "reads stored/deflated bundles (%s), preserves bytes and disables image colour conversion",
    async (compressed) => {
      const decode = vi.fn<
        (blob: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>
      >(async () => bitmap());
      vi.stubGlobal("createImageBitmap", decode);
      const bytes = bundle(compressed);
      const original = new Uint8Array(bytes).slice();
      const result = await prepareSogImages(bytes, new AbortController().signal);
      expect(result.meta).toEqual(meta);
      expect(result.images.map((image) => image.name)).toEqual(names);
      expect(new Uint8Array(bytes)).toEqual(original);
      expect(decode).toHaveBeenCalledTimes(5);
      expect(decode.mock.calls[0]![1]).toEqual({
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      expect(new Uint8Array(await decode.mock.calls[0]![0].arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
    },
  );

  it("closes every successful image when another image fails", async () => {
    const images = Array.from({ length: 4 }, bitmap);
    let index = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        if (index === 4) throw new Error("Invalid WebP");
        return images[index++];
      }),
    );
    await expect(
      prepareSogImages(bundle(), new AbortController().signal),
    ).rejects.toThrow("Invalid WebP");
    for (const image of images) expect(image.close).toHaveBeenCalledOnce();
  });

  it("includes both optional spherical-harmonic images", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap()),
    );
    const result = await prepareSogImages(
      bundle(false, false, true),
      new AbortController().signal,
    );
    expect(result.images).toHaveLength(7);
    expect(result.meta.shN?.files).toEqual(["centroids.webp", "labels.webp"]);
  });

  it("waits for outstanding decode results and closes them on cancellation", async () => {
    const controller = new AbortController();
    const images = Array.from({ length: 5 }, bitmap);
    const finish: (() => void)[] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise((resolve) => {
            const image = images[finish.length];
            finish.push(() => resolve(image));
          }),
      ),
    );
    const preparing = prepareSogImages(bundle(), controller.signal);
    const rejected = expect(preparing).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(finish).toHaveLength(5));
    controller.abort();
    finish.forEach((resolve) => resolve());
    await rejected;
    for (const image of images) expect(image.close).toHaveBeenCalledOnce();
  });

  it("requests native fallback for external images and missing worker image support", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    await expect(
      prepareSogImages(bundle(false, true), new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedSogPreparation);
    expect(createImageBitmap).not.toHaveBeenCalled();
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(
      prepareSogImages(bundle(), new AbortController().signal),
    ).rejects.toBeInstanceOf(UnsupportedSogPreparation);
  });

  it("rejects truncated and malformed bundles before image decode", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    await expect(
      prepareSogImages(new ArrayBuffer(4), new AbortController().signal),
    ).rejects.toThrow(/ZIP/);
    const bytes = bundle();
    new DataView(bytes).setUint32(bytes.byteLength - 6, 0x7fffffff, true);
    await expect(prepareSogImages(bytes, new AbortController().signal)).rejects.toThrow(
      /ZIP/,
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});

function bitmap(): ImageBitmap {
  return { width: 1, height: 1, close: vi.fn() } as ImageBitmap;
}

function bundle(compressed = false, external = false, withSh = false): ArrayBuffer {
  const shFiles = ["centroids.webp", "labels.webp"];
  const metadata = withSh ? { ...meta, shN: { files: shFiles } } : meta;
  const imageNames = withSh ? [...names, ...shFiles] : names;
  const entries = [
    ["meta.json", new TextEncoder().encode(JSON.stringify(metadata))],
    ...imageNames
      .slice(0, external ? 4 : imageNames.length)
      .map((name) => [name, new Uint8Array([1, 2, 3])] as const),
  ] as const;
  const locals: Uint8Array[] = [];
  const directories: Uint8Array[] = [];
  let offset = 0;
  for (const [filename, contents] of entries) {
    const name = new TextEncoder().encode(filename);
    const data = compressed ? new Uint8Array(deflateRawSync(contents)) : contents;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, compressed ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, contents.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const directory = new Uint8Array(46 + name.length);
    const dv = new DataView(directory.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, compressed ? 8 : 0, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, contents.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    directory.set(name, 46);
    locals.push(local);
    directories.push(directory);
    offset += local.length;
  }
  const directorySize = directories.reduce((sum, entry) => sum + entry.length, 0);
  const result = new Uint8Array(offset + directorySize + 22);
  let position = 0;
  for (const entry of [...locals, ...directories]) {
    result.set(entry, position);
    position += entry.length;
  }
  const end = new DataView(result.buffer, position);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return result.buffer;
}
