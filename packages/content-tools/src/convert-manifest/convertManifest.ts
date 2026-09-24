import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertValidManifest,
  compactManifest,
  ManifestValidationError,
} from "@6g-path/gaussian-player";

import type { CliIo } from "../cli/runCli.js";
import type { GaussianSequenceManifest } from "@6g-path/gaussian-player";

export interface ConvertManifestRequest {
  inputPath: string;
  outputPath?: string;
  regularTiming?: boolean;
  pretty?: boolean;
  force?: boolean;
}

/** Rewrite metadata only; no encoded assets are read or changed. */
export async function convertManifest(
  request: ConvertManifestRequest,
  io: CliIo,
): Promise<number> {
  let temporaryPath: string | undefined;
  try {
    const inputPath = resolve(request.inputPath);
    const outputPath =
      request.outputPath === undefined
        ? join(
            dirname(inputPath),
            `${basename(inputPath, extname(inputPath))}.v1.1.json`,
          )
        : resolve(request.outputPath);
    const source = await readFile(inputPath, "utf8");
    const manifest = assertValidManifest(JSON.parse(source) as unknown);
    rebaseAssetUrls(manifest, inputPath, outputPath);
    const document = compactManifest(
      manifest,
      request.regularTiming === undefined
        ? {}
        : { regularTiming: request.regularTiming },
    );
    const json = `${JSON.stringify(document, null, request.pretty === true ? 2 : undefined)}\n`;
    if (request.force === true) {
      const staging = `${outputPath}.${randomUUID()}.tmp`;
      const file = await open(staging, "wx");
      temporaryPath = staging;
      try {
        await file.writeFile(json);
      } finally {
        await file.close();
      }
      await rename(staging, outputPath);
      temporaryPath = undefined;
    } else {
      await writeFile(outputPath, json, { flag: "wx" });
    }
    const before = Buffer.byteLength(source);
    const after = Buffer.byteLength(json);
    io.stdout(`Wrote manifest 1.1 to ${outputPath}`);
    io.stdout(
      `  ${before} -> ${after} bytes (${((1 - after / before) * 100).toFixed(1)}% smaller); encoded assets unchanged.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      for (const issue of error.issues) io.stderr(`${issue.path}: ${issue.message}`);
    } else if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      io.stderr("Output already exists; choose another --output path or use --force.");
    } else {
      io.stderr(error instanceof Error ? error.message : String(error));
    }
    return 1;
  } finally {
    if (temporaryPath !== undefined) await rm(temporaryPath, { force: true });
  }
}

function rebaseAssetUrls(
  manifest: GaussianSequenceManifest,
  inputPath: string,
  outputPath: string,
): void {
  if (dirname(inputPath) === dirname(outputPath)) return;
  const inputUrl = pathToFileURL(inputPath);
  const rebase = (url: string): string => {
    // Absolute and site-root URLs keep their original meaning.
    if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(url)) return url;
    const asset = new URL(url, inputUrl);
    const path = relative(dirname(outputPath), fileURLToPath(asset));
    if (isAbsolute(path))
      throw new Error(
        "Cannot rebase relative assets across filesystem volumes; write the manifest on the same volume.",
      );
    return (
      path.split(sep).map(encodeURIComponent).join("/") + asset.search + asset.hash
    );
  };
  for (const object of manifest.staticObjects) {
    object.url = rebase(object.url);
    for (const quality of object.qualityLevels ?? []) {
      if (quality.url !== undefined) quality.url = rebase(quality.url);
    }
  }
  for (const sequence of manifest.dynamicSequences) {
    for (const frame of sequence.frames) {
      frame.url = rebase(frame.url);
      if (frame.metadataUrl !== undefined)
        frame.metadataUrl = rebase(frame.metadataUrl);
      for (const quality of frame.qualityLevels ?? []) {
        if (quality.url !== undefined) quality.url = rebase(quality.url);
      }
    }
  }
  for (const object of manifest.meshObjects ?? []) object.url = rebase(object.url);
  if (manifest.audio !== undefined) manifest.audio.url = rebase(manifest.audio.url);
}
