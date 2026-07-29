import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { assertValidManifest } from "@6g-path/gaussian-player";

import { runRadQualityCuts } from "../rad-cuts/runRadQualityCuts.js";
import { convertQualityCutsToSog } from "../sog/convertQualityCutsToSog.js";
import { exportStreamedSog } from "../sog/exportStreamedSog.js";

import type { CliIo } from "../cli/runCli.js";
import type { RadQualityCutsRunner } from "../rad-cuts/runRadQualityCuts.js";
import type { ConvertQualityCutsToSogRunner } from "../sog/convertQualityCutsToSog.js";
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
    frames: string[];
    id: string;
    maxSh?: number;
    minimumPlayable?: string;
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
  convertQualityCutsToSog?: ConvertQualityCutsToSogRunner;
  exportStreamedSog?: ExportStreamedSogRunner;
  runRadQualityCuts?: RadQualityCutsRunner;
}

export type BuildDatasetRunner = (
  request: BuildDatasetRequest,
  io: CliIo,
) => Promise<number>;

interface QualityCutFrame {
  qualityLevels: GaussianQualityLevel[];
  sourceFile: string;
}

interface SogQualityCutIndex {
  format: "flat-sog-quality-cuts";
  frames: QualityCutFrame[];
  version: 1;
}

/** Builds a complete externally hostable SOG dataset from ordered authoring inputs. */
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
    const dynamicInputs = configuration.dynamic.frames.map((path) =>
      resolveInput(path, configDir),
    );
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
      io.stdout(`  ${dynamicInputs.length} dynamic RAD frame(s)`);
      io.stdout(`  ${staticInputs.length} static scene(s)`);
      io.stdout(`  output: ${outputDir}`);
      return 0;
    }

    if (!request.force && (await exists(outputDir))) {
      throw new Error(`Output directory already exists: ${outputDir}`);
    }

    stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await mkdir(stagingDir, { recursive: false });
    const dynamicSpzDir = join(stagingDir, "dynamic-spz");
    const dynamicSogDir = join(stagingDir, "dynamic");
    const cutsExitCode = await (dependencies.runRadQualityCuts ?? runRadQualityCuts)(
      {
        force: false,
        inputPaths: dynamicInputs,
        ...(configuration.dynamic.maxSh === undefined
          ? {}
          : { maxSh: configuration.dynamic.maxSh }),
        ...(configuration.dynamic.minimumPlayable === undefined
          ? {}
          : { minimumPlayable: configuration.dynamic.minimumPlayable }),
        outputDir: dynamicSpzDir,
        ...(configuration.dynamic.tiers === undefined
          ? {}
          : { tiers: serialiseTiers(configuration.dynamic.tiers) }),
      },
      io,
    );
    assertStepSucceeded("RAD quality-cut extraction", cutsExitCode);

    const sog = configuration.sog ?? {};
    const conversionExitCode = await (
      dependencies.convertQualityCutsToSog ?? convertQualityCutsToSog
    )(
      {
        force: false,
        indexPath: join(dynamicSpzDir, "quality-cuts.json"),
        maxWorkers: sog.maxWorkers ?? 4,
        outputDir: dynamicSogDir,
        shIterations: sog.shIterations ?? 10,
      },
      io,
    );
    assertStepSucceeded("dynamic SOG conversion", conversionExitCode);

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
        await readFile(join(dynamicSogDir, "quality-cuts.json"), "utf8"),
      ) as unknown,
    );
    const manifest = createManifest(configuration, qualityIndex, audioUrl);
    await writeFile(
      join(stagingDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await rm(dynamicSpzDir, { force: true, recursive: true });

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
  index: SogQualityCutIndex,
  audioUrl: string | undefined,
): GaussianSequenceManifest {
  if (index.frames.length !== configuration.dynamic.frames.length) {
    throw new Error(
      `SOG quality index contains ${index.frames.length} frames; expected ${configuration.dynamic.frames.length}.`,
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
            throw new Error(`Frame ${frameIndex} has no generated SOG tier URL.`);
          }
          return {
            codec: "sog-v2",
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
  if (
    typeof value.dynamic.id !== "string" ||
    value.dynamic.id.trim() === "" ||
    !Array.isArray(value.dynamic.frames) ||
    value.dynamic.frames.length === 0 ||
    value.dynamic.frames.some((frame) => typeof frame !== "string" || frame === "")
  ) {
    throw new Error("Dynamic id and at least one ordered RAD frame are required.");
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

function parseQualityIndex(value: unknown): SogQualityCutIndex {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.format !== "flat-sog-quality-cuts" ||
    !Array.isArray(value.frames) ||
    value.frames.some(
      (frame) =>
        !isRecord(frame) ||
        typeof frame.sourceFile !== "string" ||
        !Array.isArray(frame.qualityLevels),
    )
  ) {
    throw new Error("Generated SOG quality index is invalid.");
  }
  return value as unknown as SogQualityCutIndex;
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

function validateOutputDirectory(outputDir: string, configDir: string): void {
  if (outputDir === dirname(outputDir) || outputDir === configDir) {
    throw new Error("Output directory must be a dedicated child directory.");
  }
  if (relative(configDir, outputDir) === "") {
    throw new Error("Output directory cannot replace the config directory.");
  }
}

function serialiseTiers(tiers: Record<string, number>): string {
  const entries = Object.entries(tiers);
  if (
    entries.length === 0 ||
    entries.some(
      ([name, ratio]) =>
        name.trim() === "" || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1,
    )
  ) {
    throw new Error(
      "Dynamic tiers must contain names with ratios above zero and at most one.",
    );
  }
  return entries.map(([name, ratio]) => `${name}=${ratio}`).join(",");
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
