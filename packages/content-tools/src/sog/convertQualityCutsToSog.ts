import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

interface QualityCutLevel {
  byteSize?: number;
  codec?: string;
  url: string;
  [key: string]: unknown;
}

interface QualityCutFrame {
  qualityLevels: QualityCutLevel[];
  [key: string]: unknown;
}

interface SpzQualityCutIndex {
  format: "flat-spz-quality-cuts";
  frames: QualityCutFrame[];
  version: 1;
  [key: string]: unknown;
}

interface SogQualityCutIndex extends Omit<SpzQualityCutIndex, "format"> {
  format: "flat-sog-quality-cuts";
}

export interface ConvertQualityCutsToSogRequest {
  force: boolean;
  indexPath: string;
  maxWorkers: number;
  outputDir: string;
  shIterations: number;
}

export interface ConvertQualityCutsToSogIo {
  stderr(message: string): void;
  stdout(message: string): void;
}

export interface SogAssetConversionRequest {
  force: boolean;
  inputPath: string;
  maxWorkers: number;
  outputPath: string;
  shIterations: number;
}

export type SogAssetConversionRunner = (
  request: SogAssetConversionRequest,
) => Promise<void>;

export type ConvertQualityCutsToSogRunner = (
  request: ConvertQualityCutsToSogRequest,
  io: ConvertQualityCutsToSogIo,
) => Promise<number>;

export interface ConvertQualityCutsToSogDependencies {
  convertAsset?: SogAssetConversionRunner;
}

/** Converts every local SPZ tier in a flat quality index to PlayCanvas SOG v2. */
export async function convertQualityCutsToSog(
  request: ConvertQualityCutsToSogRequest,
  io: ConvertQualityCutsToSogIo,
  dependencies: ConvertQualityCutsToSogDependencies = {},
): Promise<number> {
  try {
    validateRequest(request);
    const indexPath = resolve(request.indexPath);
    const inputDir = dirname(indexPath);
    const outputDir = resolve(request.outputDir);
    const outputIndexPath = join(outputDir, basename(indexPath));
    if (!request.force && (await exists(outputIndexPath))) {
      throw new Error(`Output index already exists: ${outputIndexPath}`);
    }

    const index = parseIndex(await readFile(indexPath, "utf8"));
    const plans = planConversions(index, inputDir, outputDir);
    const convertAsset = dependencies.convertAsset ?? runSplatTransform;
    const converted = new Map<string, { byteSize: number; url: string }>();

    for (const plan of plans) {
      await access(plan.inputPath);
      if (!request.force && (await exists(plan.outputPath))) {
        throw new Error(`Output already exists: ${plan.outputPath}`);
      }
    }

    for (const plan of plans) {
      await mkdir(dirname(plan.outputPath), { recursive: true });
      io.stdout(`SOG v2: ${plan.sourceUrl}`);
      await convertAsset({
        force: request.force,
        inputPath: plan.inputPath,
        maxWorkers: request.maxWorkers,
        outputPath: plan.outputPath,
        shIterations: request.shIterations,
      });
      await assertSog(plan.outputPath);
      converted.set(plan.sourceUrl, {
        byteSize: (await stat(plan.outputPath)).size,
        url: plan.outputUrl,
      });
    }

    const outputIndex: SogQualityCutIndex = {
      ...index,
      format: "flat-sog-quality-cuts",
      frames: index.frames.map((frame) => ({
        ...frame,
        qualityLevels: frame.qualityLevels.map((level) => {
          const output = converted.get(level.url);
          if (output === undefined) {
            throw new Error(`No converted SOG asset was produced for ${level.url}.`);
          }
          return {
            ...level,
            byteSize: output.byteSize,
            codec: "sog-v2",
            ...(isRecord(level.metadata)
              ? { metadata: { ...level.metadata, format: "sog" } }
              : {}),
            url: output.url,
          };
        }),
      })),
    };

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputIndexPath, `${JSON.stringify(outputIndex, null, 2)}\n`);
    io.stdout(`Wrote ${converted.size} SOG v2 asset(s) and ${outputIndexPath}`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runSplatTransform(request: SogAssetConversionRequest): Promise<void> {
  const libraryEntry = require.resolve("@playcanvas/splat-transform");
  const cliPath = resolve(dirname(libraryEntry), "../bin/cli.mjs");
  const args = [
    cliPath,
    "--no-tty",
    "--quiet",
    request.inputPath,
    request.outputPath,
    "--sh-iterations",
    String(request.shIterations),
    "--max-workers",
    String(request.maxWorkers),
  ];
  if (request.force) {
    args.push("--overwrite");
  }
  await execFileAsync(process.execPath, args);
}

function validateRequest(request: ConvertQualityCutsToSogRequest): void {
  if (!Number.isInteger(request.shIterations) || request.shIterations < 0) {
    throw new Error("SOG SH iterations must be a non-negative integer.");
  }
  if (!Number.isInteger(request.maxWorkers) || request.maxWorkers < 0) {
    throw new Error("SOG max workers must be a non-negative integer.");
  }
}

function parseIndex(text: string): SpzQualityCutIndex {
  const value = JSON.parse(text) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("format" in value) ||
    value.format !== "flat-spz-quality-cuts" ||
    !("frames" in value) ||
    !Array.isArray(value.frames) ||
    value.frames.length === 0 ||
    value.frames.some(
      (frame) =>
        typeof frame !== "object" ||
        frame === null ||
        !("qualityLevels" in frame) ||
        !Array.isArray(frame.qualityLevels) ||
        frame.qualityLevels.length === 0 ||
        frame.qualityLevels.some(
          (level: unknown) =>
            typeof level !== "object" ||
            level === null ||
            !("url" in level) ||
            typeof level.url !== "string" ||
            level.url.length === 0,
        ),
    )
  ) {
    throw new Error("Input is not a supported flat SPZ quality-cuts index.");
  }
  return value as SpzQualityCutIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ConversionPlan {
  inputPath: string;
  outputPath: string;
  outputUrl: string;
  sourceUrl: string;
}

function planConversions(
  index: SpzQualityCutIndex,
  inputDir: string,
  outputDir: string,
): ConversionPlan[] {
  const bySourceUrl = new Map<string, ConversionPlan>();
  const outputSources = new Map<string, string>();
  for (const frame of index.frames) {
    for (const level of frame.qualityLevels) {
      if (bySourceUrl.has(level.url)) {
        continue;
      }
      const inputPath = resolveIndexedAsset(inputDir, level.url);
      if (extname(level.url).toLowerCase() !== ".spz") {
        throw new Error(`Quality tier is not an SPZ file: ${level.url}`);
      }
      const outputUrl = `${level.url.slice(0, -extname(level.url).length)}.sog`.replace(
        /\\/g,
        "/",
      );
      const outputPath = resolveIndexedAsset(outputDir, outputUrl);
      const collisionKey =
        process.platform === "win32" ? outputPath.toLowerCase() : outputPath;
      const collidingSource = outputSources.get(collisionKey);
      if (collidingSource !== undefined && collidingSource !== level.url) {
        throw new Error(
          `SPZ tier URLs map to the same SOG output: ${collidingSource}, ${level.url}`,
        );
      }
      outputSources.set(collisionKey, level.url);
      bySourceUrl.set(level.url, {
        inputPath,
        outputPath,
        outputUrl,
        sourceUrl: level.url,
      });
    }
  }
  return [...bySourceUrl.values()];
}

function resolveIndexedAsset(root: string, url: string): string {
  if (/^https?:\/\//i.test(url)) {
    throw new Error(
      `Remote SPZ tier sources are not supported by offline SOG conversion: ${url}`,
    );
  }
  if (isAbsolute(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) {
    throw new Error(`Quality tier URL must be a relative local path: ${url}`);
  }
  const path = resolve(root, url);
  const relation = relative(root, path);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Quality tier URL escapes its index directory: ${url}`);
  }
  return path;
}

async function assertSog(path: string): Promise<void> {
  const bytes = await readFile(path);
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    !(
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    )
  ) {
    throw new Error(`splat-transform did not produce a SOG ZIP bundle: ${path}`);
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
