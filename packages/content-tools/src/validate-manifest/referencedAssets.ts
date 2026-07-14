import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ManifestFileIssue, ValidateManifestFileOptions } from "./types.js";
import type { GaussianSequenceManifest } from "@6g-path/gaussian-player";

interface ReferencedAsset {
  path: string;
  url: string;
}

export async function validateReferencedAssets(
  manifest: GaussianSequenceManifest,
  manifestPath: string,
  options: ValidateManifestFileOptions,
): Promise<ManifestFileIssue[]> {
  const issues = await Promise.all(
    collectReferencedAssets(manifest).map((asset) =>
      validateReferencedAsset(asset, manifestPath, options),
    ),
  );
  return issues.filter((issue): issue is ManifestFileIssue => issue !== undefined);
}

function collectReferencedAssets(
  manifest: GaussianSequenceManifest,
): ReferencedAsset[] {
  const assets: ReferencedAsset[] = [];

  for (const [index, object] of manifest.staticObjects.entries()) {
    assets.push({ path: `/staticObjects/${index}/url`, url: object.url });
  }
  for (const [sequenceIndex, sequence] of manifest.dynamicSequences.entries()) {
    for (const [frameIndex, frame] of sequence.frames.entries()) {
      const framePath = `/dynamicSequences/${sequenceIndex}/frames/${frameIndex}`;
      assets.push({ path: `${framePath}/url`, url: frame.url });
      if (frame.metadataUrl !== undefined) {
        assets.push({ path: `${framePath}/metadataUrl`, url: frame.metadataUrl });
      }
    }
  }
  for (const [index, object] of (manifest.meshObjects ?? []).entries()) {
    assets.push({ path: `/meshObjects/${index}/url`, url: object.url });
  }
  if (manifest.audio !== undefined) {
    assets.push({ path: "/audio/url", url: manifest.audio.url });
  }

  return assets;
}

async function validateReferencedAsset(
  asset: ReferencedAsset,
  manifestPath: string,
  options: ValidateManifestFileOptions,
): Promise<ManifestFileIssue | undefined> {
  const absoluteUrl = parseAbsoluteUrl(asset.url);
  if (absoluteUrl?.protocol === "http:" || absoluteUrl?.protocol === "https:") {
    return validateRemoteAsset(asset, absoluteUrl, options);
  }
  if (absoluteUrl !== undefined && absoluteUrl.protocol !== "file:") {
    return undefined;
  }

  const assetPath =
    absoluteUrl?.protocol === "file:"
      ? fileURLToPath(absoluteUrl)
      : resolve(dirname(manifestPath), asset.url);
  try {
    await access(assetPath);
    return undefined;
  } catch {
    return {
      code: "asset-missing",
      message: `referenced file does not exist: ${assetPath}`,
      path: asset.path,
    };
  }
}

async function validateRemoteAsset(
  asset: ReferencedAsset,
  url: URL,
  options: ValidateManifestFileOptions,
): Promise<ManifestFileIssue | undefined> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (fetchImplementation === undefined) {
    return {
      code: "asset-request",
      message: `cannot verify remote asset because fetch is unavailable: ${url.href}`,
      path: asset.path,
    };
  }

  try {
    const response = await fetchImplementation(
      url,
      options.signal === undefined
        ? { method: "HEAD" }
        : { method: "HEAD", signal: options.signal },
    );
    return response.ok
      ? undefined
      : {
          code: "asset-missing",
          message: `remote asset returned HTTP ${response.status}: ${url.href}`,
          path: asset.path,
        };
  } catch (cause) {
    return {
      code: "asset-request",
      message: `failed to verify remote asset ${url.href}: ${describeCause(cause)}`,
      path: asset.path,
    };
  }
}

function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
