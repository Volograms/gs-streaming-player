import {
  GSplatSogData,
  GSplatSogResource,
  PIXELFORMAT_RGBA8,
  Texture,
} from "playcanvas";

import { closeSogImages } from "./sogPreparation.js";

import type { PreparedSogImages } from "./sogPreparation.js";
import type { GraphicsDevice } from "playcanvas";

/** Takes ownership of every bitmap, on both success and failure. */
export async function createSogResource(
  device: GraphicsDevice,
  url: string,
  prepared: PreparedSogImages,
  prepareCenters: boolean,
  signal: AbortSignal,
): Promise<GSplatSogResource> {
  const data = new GSplatSogData();
  const textures = new Map<string, Texture>();
  const abort = () => data.destroy();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (const { name, bitmap } of prepared.images) {
      const texture = new Texture(device, {
        name: `${url}/${name}`,
        width: bitmap.width,
        height: bitmap.height,
        format: PIXELFORMAT_RGBA8,
        mipmaps: false,
      });
      textures.set(name, texture);
      // PlayCanvas's own image parser passes ImageBitmap here; 2.23.2's public
      // declaration still lists only DOM elements for this supported source type.
      (texture as unknown as { setSource(source: ImageBitmap): void }).setSource(
        bitmap,
      );
    }
    const { meta } = prepared;
    const texture = (name: string | undefined): Texture => {
      const result = name === undefined ? undefined : textures.get(name);
      if (result === undefined)
        throw new Error(`Missing prepared SOG texture '${name}'.`);
      return result;
    };
    data.url = url;
    data.meta = meta;
    data.numSplats = meta.count;
    data.means_l = texture(meta.means.files[0]);
    data.means_u = texture(meta.means.files[1]);
    data.quats = texture(meta.quats.files[0]);
    data.scales = texture(meta.scales.files[0]);
    data.sh0 = texture(meta.sh0.files[0]);
    if (meta.shN?.files.length) {
      data.sh_centroids = texture(meta.shN.files[0]);
      data.sh_labels = texture(meta.shN.files[1]);
    }
    data.shBands = GSplatSogData.calcBands(data.sh_centroids?.width);
    data.prepareCodebook();
    if (prepareCenters) await data.prepareGpuData();
    signal.throwIfAborted();
    return new GSplatSogResource(device, data, { prepareCenters });
  } catch (error) {
    data.destroy();
    for (const texture of textures.values()) texture.destroy();
    closeSogImages(prepared);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
