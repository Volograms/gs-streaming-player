import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runSplatTransformCli } from "./runSplatTransformCli.js";

import type { SplatTransformCliRunner } from "./runSplatTransformCli.js";

export interface ExportStreamedSogRequest {
  force: boolean;
  inputPath: string;
  lodChunkCount: number;
  lodChunkExtent: number;
  lodRatios: readonly number[];
  maxWorkers: number;
  outputDir: string;
  shIterations: number;
}

export interface ExportStreamedSogIo {
  stderr(message: string): void;
  stdout(message: string): void;
}

export interface ExportStreamedSogDependencies {
  runSplatTransform?: SplatTransformCliRunner;
}

export type ExportStreamedSogRunner = (
  request: ExportStreamedSogRequest,
  io: ExportStreamedSogIo,
) => Promise<number>;

/**
 * Creates genuine multi-resolution, spatially chunked PlayCanvas Streamed SOG output.
 * Coarser levels are materialised as temporary PLY files before tagging and combining
 * them into a spatial LOD tree.
 */
export async function exportStreamedSog(
  request: ExportStreamedSogRequest,
  io: ExportStreamedSogIo,
  dependencies: ExportStreamedSogDependencies = {},
): Promise<number> {
  let temporaryDir: string | undefined;
  try {
    validateRequest(request);
    const inputPath = resolve(request.inputPath);
    const outputDir = resolve(request.outputDir);
    const outputIndexPath = join(outputDir, "lod-meta.json");
    await access(inputPath);
    if (!request.force && (await exists(outputIndexPath))) {
      throw new Error(`Output index already exists: ${outputIndexPath}`);
    }

    await mkdir(outputDir, { recursive: true });
    temporaryDir = await mkdtemp(join(tmpdir(), "gs-streaming-player-sog-lod-"));
    const runSplatTransform = dependencies.runSplatTransform ?? runSplatTransformCli;
    const lodInputs: string[] = [];
    if (/\.ply$/i.test(inputPath)) {
      lodInputs.push(inputPath);
    } else {
      const fullDetailPath = join(temporaryDir, "lod-0.ply");
      io.stdout("Materialising full-detail LOD 0 as PLY.");
      await runSplatTransform([inputPath, fullDetailPath]);
      await access(fullDetailPath);
      lodInputs.push(fullDetailPath);
    }

    for (let level = 1; level < request.lodRatios.length; level += 1) {
      const ratio = request.lodRatios[level];
      if (ratio === undefined) {
        throw new Error(`Missing LOD ratio for level ${level}.`);
      }
      const outputPath = join(temporaryDir, `lod-${level}.ply`);
      io.stdout(`Decimating LOD ${level} to ${formatPercent(ratio)}.`);
      await runSplatTransform([
        inputPath,
        "--decimate-adaptive",
        formatPercent(ratio),
        "--scratch-dir",
        temporaryDir,
        outputPath,
      ]);
      await access(outputPath);
      lodInputs.push(outputPath);
    }

    const exportArgs = [
      "--lod-chunk-count",
      String(request.lodChunkCount),
      "--lod-chunk-extent",
      String(request.lodChunkExtent),
    ];
    for (const [level, path] of lodInputs.entries()) {
      exportArgs.push(path, "--tag-lod", String(level));
    }
    exportArgs.push(
      outputIndexPath,
      "--sh-iterations",
      String(request.shIterations),
      "--max-workers",
      String(request.maxWorkers),
    );
    if (request.force) {
      exportArgs.push("--overwrite");
    }

    io.stdout(
      `Writing ${request.lodRatios.length} Streamed SOG levels to ${outputIndexPath}.`,
    );
    await runSplatTransform(exportArgs);
    await assertStreamedSogIndex(outputIndexPath, request.lodRatios.length);
    io.stdout(`Wrote PlayCanvas Streamed SOG scene ${outputIndexPath}`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (temporaryDir !== undefined) {
      await rm(temporaryDir, { force: true, recursive: true });
    }
  }
}

function validateRequest(request: ExportStreamedSogRequest): void {
  if (!Number.isInteger(request.shIterations) || request.shIterations < 0) {
    throw new Error("SOG SH iterations must be a non-negative integer.");
  }
  if (!Number.isInteger(request.maxWorkers) || request.maxWorkers < 0) {
    throw new Error("SOG max workers must be a non-negative integer.");
  }
  if (!Number.isInteger(request.lodChunkCount) || request.lodChunkCount <= 0) {
    throw new Error("LOD chunk count must be a positive integer in thousands.");
  }
  if (!Number.isFinite(request.lodChunkExtent) || request.lodChunkExtent <= 0) {
    throw new Error("LOD chunk extent must be a positive number.");
  }
  if (request.lodRatios.length < 2 || request.lodRatios[0] !== 1) {
    throw new Error(
      "LOD ratios must start with 1 and contain at least one coarse level.",
    );
  }
  for (let index = 0; index < request.lodRatios.length; index += 1) {
    const ratio = request.lodRatios[index];
    const previous = request.lodRatios[index - 1];
    if (
      ratio === undefined ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio > 1 ||
      (previous !== undefined && ratio >= previous)
    ) {
      throw new Error(
        "LOD ratios must be finite, positive, strictly descending values beginning with 1.",
      );
    }
  }
}

function formatPercent(ratio: number): string {
  return `${Number((ratio * 100).toPrecision(12))}%`;
}

async function assertStreamedSogIndex(
  path: string,
  expectedLevels: number,
): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("lodLevels" in value) ||
    value.lodLevels !== expectedLevels ||
    !("counts" in value) ||
    !Array.isArray(value.counts) ||
    value.counts.length !== expectedLevels ||
    !("filenames" in value) ||
    !Array.isArray(value.filenames) ||
    value.filenames.length === 0 ||
    !("tree" in value) ||
    typeof value.tree !== "object" ||
    value.tree === null
  ) {
    throw new Error(`splat-transform did not produce a Streamed SOG index: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
