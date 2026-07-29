import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { assertValidManifest } from "@6g-path/gaussian-player";

import { generateDynamicTiers } from "../dynamic-tiers/generateDynamicTiers.js";
import { exportStreamedSog } from "../sog/exportStreamedSog.js";

import type { CliIo } from "../cli/runCli.js";
import type {
  DynamicTierOutputFormat,
  GenerateDynamicTiersRunner,
} from "../dynamic-tiers/generateDynamicTiers.js";
import type { ExportStreamedSogRunner } from "../sog/exportStreamedSog.js";
import type {
  GaussianQualityLevel,
  GaussianSequenceManifest,
} from "@6g-path/gaussian-player";

export interface DatasetBuildTransform {
  matrix?: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  position?: { x: number; y: number; z: number };
  rotation?: { w: number; x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
}

export interface DatasetBuildConfiguration {
  audio?: {
    contentType?: string;
    input: string;
    offsetSeconds?: number;
  };
  dynamic: {
    frameWorkers?: number;
    frames?: string[];
    id: string;
    inputDir?: string;
    maxSh?: number;
    minimumPlayable?: string;
    outputFormat?: DynamicTierOutputFormat;
    tiers?: Record<string, number>;
    transform?: DatasetBuildTransform;
  };
  frameRate: number;
  id: string;
  sog?: {
    lodChunkCount?: number;
    lodChunkExtent?: number;
    lodRatios?: number[];
    maxWorkers?: number;
    shIterations?: number;
  };
  staticObjects?: Array<{
    id: string;
    input: string;
    priority?: number;
    transform?: DatasetBuildTransform;
  }>;
  version: 1;
}

export interface BuildDatasetRequest {
  configPath: string;
  dryRun: boolean;
  force: boolean;
  outputDir: string;
}

export interface BuildDatasetDependencies {
  exportStreamedSog?: ExportStreamedSogRunner;
  generateDynamicTiers?: GenerateDynamicTiersRunner;
}

export type BuildDatasetRunner = (
  request: BuildDatasetRequest,
  io: CliIo,
) => Promise<number>;

interface QualityCutFrame {
  qualityLevels: GaussianQualityLevel[];
  sourceFile: string;
}

interface DynamicQualityCutIndex {
  format: "flat-sog-quality-cuts" | "flat-spz-quality-cuts";
  frames: QualityCutFrame[];
  version: 1;
}

/** Builds an externally hostable dataset from ordered PLY or SPZ frame sources. */
export async function buildDataset(
  request: BuildDatasetRequest,
  io: CliIo,
  dependencies: BuildDatasetDependencies = {},
): Promise<number> {
  let stagingDir: string | undefined;
  try {
    const configPath = resolve(request.configPath);
    const outputDir = resolve(request.outputDir);
    const configuration = parseConfiguration(
      JSON.parse(await readFile(configPath, "utf8")) as unknown,
    );
    const configDir = dirname(configPath);
    validateOutputDirectory(outputDir, configDir);
    const dynamicInputs = await resolveDynamicInputs(configuration, configDir);
    const staticInputs = (configuration.staticObjects ?? []).map((object) => ({
      ...object,
      input: resolveInput(object.input, configDir),
    }));
    const audioInput =
      configuration.audio === undefined
        ? undefined
        : resolveInput(configuration.audio.input, configDir);

    await Promise.all([
      ...dynamicInputs.map((path) => access(path)),
      ...staticInputs.map(({ input }) => access(input)),
      ...(audioInput === undefined ? [] : [access(audioInput)]),
    ]);

    if (request.dryRun) {
      io.stdout(`Dataset build plan: ${configuration.id}`);
      io.stdout(
        `  ${dynamicInputs.length} dynamic PLY/SPZ frame(s) -> ${(configuration.dynamic.outputFormat ?? "sog").toUpperCase()} tiers`,
      );
      io.stdout(`  frame workers: ${configuration.dynamic.frameWorkers ?? "auto"}`);
      io.stdout(`  ${staticInputs.length} static scene(s)`);
      io.stdout(`  output: ${outputDir}`);
      return 0;
    }

    if (!request.force && (await exists(outputDir))) {
      throw new Error(`Output directory already exists: ${outputDir}`);
    }

    stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await mkdir(stagingDir, { recursive: false });
    const dynamicDir = join(stagingDir, "dynamic");
    const dynamicExitCode = await (
      dependencies.generateDynamicTiers ?? generateDynamicTiers
    )(
      {
        frameWorkers: configuration.dynamic.frameWorkers ?? 0,
        force: false,
        inputPaths: dynamicInputs,
        ...(configuration.dynamic.maxSh === undefined
          ? {}
          : { maxSh: configuration.dynamic.maxSh }),
        maxWorkers: configuration.sog?.maxWorkers ?? 4,
        minimumPlayable: configuration.dynamic.minimumPlayable ?? "minimum",
        outputDir: dynamicDir,
        outputFormat: configuration.dynamic.outputFormat ?? "sog",
        shIterations: configuration.sog?.shIterations ?? 10,
        tiers: configuration.dynamic.tiers ?? {
          preview: 0.1,
          minimum: 0.25,
          medium: 0.5,
          full: 1,
        },
      },
      io,
    );
    assertStepSucceeded("dynamic quality-tier generation", dynamicExitCode);
    const sog = configuration.sog ?? {};

    for (const object of staticInputs) {
      const exitCode = await (dependencies.exportStreamedSog ?? exportStreamedSog)(
        {
          force: false,
          inputPath: object.input,
          lodChunkCount: sog.lodChunkCount ?? 512,
          lodChunkExtent: sog.lodChunkExtent ?? 16,
          lodRatios: sog.lodRatios ?? [1, 0.5, 0.25, 0.1],
          maxWorkers: sog.maxWorkers ?? 4,
          outputDir: join(stagingDir, "static", object.id),
          shIterations: sog.shIterations ?? 10,
        },
        io,
      );
      assertStepSucceeded(`static SOG export '${object.id}'`, exitCode);
    }

    const audioUrl =
      audioInput === undefined ? undefined : await stageAudio(audioInput, stagingDir);
    const qualityIndex = parseQualityIndex(
      JSON.parse(
        await readFile(join(dynamicDir, "quality-cuts.json"), "utf8"),
      ) as unknown,
    );
    const manifest = createManifest(
      configuration,
      qualityIndex,
      dynamicInputs.length,
      audioUrl,
    );
    await writeFile(
      join(stagingDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    if (request.force && (await exists(outputDir))) {
      await rm(outputDir, { force: true, recursive: true });
    }
    await mkdir(dirname(outputDir), { recursive: true });
    await rename(stagingDir, outputDir);
    stagingDir = undefined;
    io.stdout(`Wrote validated dataset '${configuration.id}' to ${outputDir}`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (stagingDir !== undefined) {
      await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

function createManifest(
  configuration: DatasetBuildConfiguration,
  index: DynamicQualityCutIndex,
  expectedFrameCount: number,
  audioUrl: string | undefined,
): GaussianSequenceManifest {
  const outputFormat = configuration.dynamic.outputFormat ?? "sog";
  const expectedIndexFormat =
    outputFormat === "sog" ? "flat-sog-quality-cuts" : "flat-spz-quality-cuts";
  if (index.format !== expectedIndexFormat) {
    throw new Error(
      `Dynamic quality index format '${index.format}' does not match requested '${outputFormat}' output.`,
    );
  }
  if (index.frames.length !== expectedFrameCount) {
    throw new Error(
      `Dynamic quality index contains ${index.frames.length} frames; expected ${expectedFrameCount}.`,
    );
  }
  const frameCount = index.frames.length;
  const durationSeconds = frameCount / configuration.frameRate;
  return assertValidManifest({
    ...(configuration.audio === undefined || audioUrl === undefined
      ? {}
      : {
          audio: {
            ...(configuration.audio.contentType === undefined
              ? {}
              : { contentType: configuration.audio.contentType }),
            ...(configuration.audio.offsetSeconds === undefined
              ? {}
              : { offsetSeconds: configuration.audio.offsetSeconds }),
            url: audioUrl,
          },
        }),
    durationSeconds,
    dynamicSequences: [
      {
        frameCount,
        frameRate: configuration.frameRate,
        frames: index.frames.map((frame, frameIndex) => {
          const qualityLevels = frame.qualityLevels.map((quality) => ({
            ...quality,
            ...(quality.url === undefined
              ? {}
              : { url: `dynamic/${quality.url.replaceAll("\\", "/")}` }),
          }));
          const fallback =
            qualityLevels.find(({ minimumPlayable }) => minimumPlayable)?.url ??
            qualityLevels[0]?.url;
          if (fallback === undefined) {
            throw new Error(`Frame ${frameIndex} has no generated quality-tier URL.`);
          }
          return {
            codec: outputFormat === "spz" ? "spz-v4" : "sog-v2",
            frameIndex,
            metadata: { sourceFile: frame.sourceFile },
            qualityLevels,
            timestampSeconds: frameIndex / configuration.frameRate,
            url: fallback,
          };
        }),
        id: configuration.dynamic.id,
        ...(configuration.dynamic.transform === undefined
          ? {}
          : { transform: configuration.dynamic.transform }),
      },
    ],
    frameCount,
    frameRate: configuration.frameRate,
    id: configuration.id,
    staticObjects: (configuration.staticObjects ?? []).map((object) => ({
      id: object.id,
      ...(object.priority === undefined ? {} : { priority: object.priority }),
      ...(object.transform === undefined ? {} : { transform: object.transform }),
      url: `static/${encodeURIComponent(object.id)}/lod-meta.json`,
    })),
    version: "1.0",
  });
}

function parseConfiguration(value: unknown): DatasetBuildConfiguration {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Dataset config must be an object with version 1.");
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error("Dataset config id must be a non-empty string.");
  }
  if (typeof value.frameRate !== "number" || value.frameRate <= 0) {
    throw new Error("Dataset config frameRate must be a positive number.");
  }
  if (!isRecord(value.dynamic)) {
    throw new Error("Dataset config dynamic section is required.");
  }
  if (typeof value.dynamic.id !== "string" || value.dynamic.id.trim() === "") {
    throw new Error("Dynamic id must be a non-empty string.");
  }
  const hasFrames = value.dynamic.frames !== undefined;
  const hasInputDir = value.dynamic.inputDir !== undefined;
  if (hasFrames === hasInputDir) {
    throw new Error("Dynamic content requires exactly one of frames or inputDir.");
  }
  if (
    hasFrames &&
    (!Array.isArray(value.dynamic.frames) ||
      value.dynamic.frames.length === 0 ||
      value.dynamic.frames.some(
        (frame) => typeof frame !== "string" || frame.trim() === "",
      ))
  ) {
    throw new Error("dynamic.frames must contain at least one ordered path.");
  }
  if (
    hasInputDir &&
    (typeof value.dynamic.inputDir !== "string" || value.dynamic.inputDir.trim() === "")
  ) {
    throw new Error("dynamic.inputDir must be a non-empty string.");
  }
  if (
    Array.isArray(value.dynamic.frames) &&
    value.dynamic.frames.some((frame) => !/\.(?:ply|spz)$/i.test(frame as string))
  ) {
    throw new Error("Every dynamic frame input must be a PLY or SPZ file.");
  }
  if (
    value.dynamic.outputFormat !== undefined &&
    value.dynamic.outputFormat !== "sog" &&
    value.dynamic.outputFormat !== "spz"
  ) {
    throw new Error("dynamic.outputFormat must be 'sog' or 'spz'.");
  }
  if (
    value.dynamic.maxSh !== undefined &&
    (!Number.isInteger(value.dynamic.maxSh) ||
      (value.dynamic.maxSh as number) < 0 ||
      (value.dynamic.maxSh as number) > 3)
  ) {
    throw new Error("dynamic.maxSh must be an integer between 0 and 3.");
  }
  if (
    value.dynamic.frameWorkers !== undefined &&
    (!Number.isInteger(value.dynamic.frameWorkers) ||
      (value.dynamic.frameWorkers as number) < 0)
  ) {
    throw new Error("dynamic.frameWorkers must be a non-negative integer.");
  }
  const configuredTiers = value.dynamic.tiers;
  if (
    configuredTiers !== undefined &&
    (!isRecord(configuredTiers) ||
      Object.keys(configuredTiers).length === 0 ||
      Object.entries(configuredTiers).some(
        ([name, ratio]) =>
          !/^[a-zA-Z0-9_-]+$/.test(name) ||
          typeof ratio !== "number" ||
          !Number.isFinite(ratio) ||
          ratio <= 0 ||
          ratio > 1,
      ))
  ) {
    throw new Error(
      "dynamic.tiers must contain filesystem-safe names and ratios above zero and at most one.",
    );
  }
  const tierNames =
    configuredTiers === undefined
      ? ["preview", "minimum", "medium", "full"]
      : Object.keys(configuredTiers);
  const minimumPlayable = value.dynamic.minimumPlayable ?? "minimum";
  if (!tierNames.includes(minimumPlayable as string)) {
    throw new Error(
      `dynamic.minimumPlayable '${String(minimumPlayable)}' is not present in dynamic.tiers.`,
    );
  }
  if (
    value.staticObjects !== undefined &&
    (!Array.isArray(value.staticObjects) ||
      value.staticObjects.some(
        (object) =>
          !isRecord(object) ||
          typeof object.id !== "string" ||
          typeof object.input !== "string",
      ))
  ) {
    throw new Error("staticObjects must contain objects with id and input strings.");
  }
  if (
    value.audio !== undefined &&
    (!isRecord(value.audio) || typeof value.audio.input !== "string")
  ) {
    throw new Error("audio.input must be a string when audio is configured.");
  }
  return value as unknown as DatasetBuildConfiguration;
}

function parseQualityIndex(value: unknown): DynamicQualityCutIndex {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (value.format !== "flat-sog-quality-cuts" &&
      value.format !== "flat-spz-quality-cuts") ||
    !Array.isArray(value.frames) ||
    value.frames.some(
      (frame) =>
        !isRecord(frame) ||
        typeof frame.sourceFile !== "string" ||
        !Array.isArray(frame.qualityLevels),
    )
  ) {
    throw new Error("Generated dynamic quality index is invalid.");
  }
  return value as unknown as DynamicQualityCutIndex;
}

async function stageAudio(inputPath: string, stagingDir: string): Promise<string> {
  const filename = basename(inputPath);
  const outputDir = join(stagingDir, "audio");
  await mkdir(outputDir, { recursive: true });
  await copyFile(inputPath, join(outputDir, filename));
  return `audio/${encodeURIComponent(filename)}`;
}

function resolveInput(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

async function resolveDynamicInputs(
  configuration: DatasetBuildConfiguration,
  configDir: string,
): Promise<string[]> {
  if (configuration.dynamic.frames !== undefined) {
    return configuration.dynamic.frames.map((path) => resolveInput(path, configDir));
  }

  const configuredInputDir = configuration.dynamic.inputDir;
  if (configuredInputDir === undefined) {
    throw new Error("Dynamic content has no configured input source.");
  }
  const inputDir = resolveInput(configuredInputDir, configDir);
  const entries = await readdir(inputDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && /\.(?:ply|spz)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareFrameFilenames);
  if (filenames.length === 0) {
    throw new Error(
      `Dynamic input directory contains no top-level PLY or SPZ frames: ${inputDir}`,
    );
  }
  return filenames.map((filename) => join(inputDir, filename));
}

function compareFrameFilenames(left: string, right: string): number {
  const naturalOrder = left.localeCompare(right, "en", {
    numeric: true,
    sensitivity: "base",
  });
  return naturalOrder === 0 ? left.localeCompare(right, "en") : naturalOrder;
}

function validateOutputDirectory(outputDir: string, configDir: string): void {
  if (outputDir === dirname(outputDir) || outputDir === configDir) {
    throw new Error("Output directory must be a dedicated child directory.");
  }
  if (relative(configDir, outputDir) === "") {
    throw new Error("Output directory cannot replace the config directory.");
  }
}

function assertStepSucceeded(name: string, exitCode: number): void {
  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}.`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
