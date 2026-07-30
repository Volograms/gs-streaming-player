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
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

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
  StaticSceneObject,
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
  /** Authoring convenience converted to a manifest quaternion at build time. */
  rotationDegrees?: { x: number; y: number; z: number };
  /** A number is expanded to uniform XYZ scale at build time. */
  scale?: number | { x: number; y: number; z: number };
}

type ManifestTransform = NonNullable<StaticSceneObject["transform"]>;

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
  frameWorkers?: number;
  force: boolean;
  maxWorkers?: number;
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

const GENERATED_OUTPUT_ENTRIES = [
  "manifest.json",
  "dynamic",
  "static",
  "audio",
] as const;

/** Builds an externally hostable dataset from ordered PLY or SPZ frame sources. */
export async function buildDataset(
  request: BuildDatasetRequest,
  io: CliIo,
  dependencies: BuildDatasetDependencies = {},
): Promise<number> {
  let stagingDir: string | undefined;
  try {
    if (
      request.frameWorkers !== undefined &&
      (!Number.isInteger(request.frameWorkers) || request.frameWorkers < 0)
    ) {
      throw new Error("Build frameWorkers must be a non-negative integer.");
    }
    if (
      request.maxWorkers !== undefined &&
      (!Number.isInteger(request.maxWorkers) || request.maxWorkers < 0)
    ) {
      throw new Error("Build maxWorkers must be a non-negative integer.");
    }
    const configPath = resolve(request.configPath);
    const outputDir = resolve(request.outputDir);
    const configuration = parseConfiguration(
      JSON.parse(await readFile(configPath, "utf8")) as unknown,
    );
    const configDir = dirname(configPath);
    const frameWorkers =
      request.frameWorkers ?? configuration.dynamic.frameWorkers ?? 0;
    const maxWorkers = request.maxWorkers ?? configuration.sog?.maxWorkers ?? 4;
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
      io.stdout(`  frame workers: ${frameWorkers === 0 ? "auto" : frameWorkers}`);
      io.stdout(`  SOG encoder workers per frame: ${maxWorkers}`);
      io.stdout(`  ${staticInputs.length} static scene(s)`);
      io.stdout(`  output: ${outputDir}`);
      return 0;
    }

    if (await exists(outputDir)) {
      if (!request.force) {
        throw new Error(`Output directory already exists: ${outputDir}`);
      }
      await assertSafeGeneratedOutput(outputDir);
    }

    stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await mkdir(stagingDir, { recursive: false });
    const dynamicDir = join(stagingDir, "dynamic");
    const dynamicExitCode = await (
      dependencies.generateDynamicTiers ?? generateDynamicTiers
    )(
      {
        frameWorkers,
        force: false,
        inputPaths: dynamicInputs,
        ...(configuration.dynamic.maxSh === undefined
          ? {}
          : { maxSh: configuration.dynamic.maxSh }),
        maxWorkers,
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
          maxWorkers,
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
    await mkdir(dirname(outputDir), { recursive: true });
    await promoteStagedDataset(stagingDir, outputDir);
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
  const dynamicTransform = normaliseBuildTransform(configuration.dynamic.transform);
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
        ...(dynamicTransform === undefined ? {} : { transform: dynamicTransform }),
      },
    ],
    frameCount,
    frameRate: configuration.frameRate,
    id: configuration.id,
    staticObjects: (configuration.staticObjects ?? []).map((object) => {
      const transform = normaliseBuildTransform(object.transform);
      return {
        id: object.id,
        ...(object.priority === undefined ? {} : { priority: object.priority }),
        ...(transform === undefined ? {} : { transform }),
        url: `static/${encodeURIComponent(object.id)}/lod-meta.json`,
      };
    }),
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
  validateBuildTransform(value.dynamic.transform, "dynamic.transform");
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
          !isSafePathSegment(object.id) ||
          typeof object.input !== "string",
      ))
  ) {
    throw new Error(
      "staticObjects must contain objects with a path-safe id and an input string.",
    );
  }
  if (Array.isArray(value.staticObjects)) {
    value.staticObjects.forEach((object, index) => {
      if (isRecord(object)) {
        validateBuildTransform(object.transform, `staticObjects[${index}].transform`);
      }
    });
  }
  if (
    value.audio !== undefined &&
    (!isRecord(value.audio) || typeof value.audio.input !== "string")
  ) {
    throw new Error("audio.input must be a string when audio is configured.");
  }
  return value as unknown as DatasetBuildConfiguration;
}

function validateBuildTransform(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const allowedFields = new Set([
    "matrix",
    "position",
    "rotation",
    "rotationDegrees",
    "scale",
  ]);
  const unknownField = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unknownField !== undefined) {
    throw new Error(`${label} contains unknown field '${unknownField}'.`);
  }
  if (value.rotation !== undefined && value.rotationDegrees !== undefined) {
    throw new Error(`${label} cannot define both rotation and rotationDegrees.`);
  }
  if (value.position !== undefined && !isFiniteVector3(value.position)) {
    throw new Error(`${label}.position must contain finite x, y, and z numbers.`);
  }
  if (value.rotationDegrees !== undefined && !isFiniteVector3(value.rotationDegrees)) {
    throw new Error(
      `${label}.rotationDegrees must contain finite x, y, and z numbers.`,
    );
  }
  if (value.rotation !== undefined && !isFiniteQuaternion(value.rotation)) {
    throw new Error(`${label}.rotation must contain finite w, x, y, and z numbers.`);
  }
  if (
    value.scale !== undefined &&
    !isFiniteNumber(value.scale) &&
    !isFiniteVector3(value.scale)
  ) {
    throw new Error(`${label}.scale must be a finite number or XYZ object.`);
  }
  if (
    value.matrix !== undefined &&
    (!Array.isArray(value.matrix) ||
      value.matrix.length !== 16 ||
      value.matrix.some((component) => !isFiniteNumber(component)))
  ) {
    throw new Error(`${label}.matrix must contain exactly 16 finite numbers.`);
  }
}

function normaliseBuildTransform(
  transform: DatasetBuildTransform | undefined,
): ManifestTransform | undefined {
  if (transform === undefined) return undefined;
  const rotation =
    transform.rotationDegrees === undefined
      ? transform.rotation
      : quaternionFromEulerDegrees(transform.rotationDegrees);
  const scale =
    typeof transform.scale === "number"
      ? { x: transform.scale, y: transform.scale, z: transform.scale }
      : transform.scale;
  return {
    ...(transform.matrix === undefined ? {} : { matrix: transform.matrix }),
    ...(transform.position === undefined ? {} : { position: transform.position }),
    ...(rotation === undefined ? {} : { rotation }),
    ...(scale === undefined ? {} : { scale }),
  };
}

/** Matches PlayCanvas Quat.setFromEulerAngles (XYZ degrees). */
function quaternionFromEulerDegrees({ x, y, z }: { x: number; y: number; z: number }): {
  w: number;
  x: number;
  y: number;
  z: number;
} {
  const halfToRadians = Math.PI / 360;
  const sx = Math.sin(x * halfToRadians);
  const cx = Math.cos(x * halfToRadians);
  const sy = Math.sin(y * halfToRadians);
  const cy = Math.cos(y * halfToRadians);
  const sz = Math.sin(z * halfToRadians);
  const cz = Math.cos(z * halfToRadians);
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
}

function isFiniteVector3(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isFiniteQuaternion(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.w) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafePathSegment(value: string): boolean {
  return value.trim() !== "" && value !== "." && value !== ".." && !/[\\/]/.test(value);
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
    throw new Error(
      "Output directory cannot be the filesystem root or config directory.",
    );
  }
}

async function assertSafeGeneratedOutput(outputDir: string): Promise<void> {
  const outputInfo = await stat(outputDir);
  if (!outputInfo.isDirectory()) {
    throw new Error(`Output path is not a directory: ${outputDir}`);
  }

  const existingGeneratedEntries = (
    await Promise.all(
      GENERATED_OUTPUT_ENTRIES.map(async (entry) => ({
        entry,
        exists: await exists(join(outputDir, entry)),
      })),
    )
  ).filter(({ exists: entryExists }) => entryExists);
  if (existingGeneratedEntries.length === 0) {
    return;
  }

  const manifestPath = join(outputDir, "manifest.json");
  if (!(await exists(manifestPath))) {
    throw new Error(
      `Refusing to replace generated-looking entries without an existing manifest.json: ${outputDir}`,
    );
  }
  try {
    assertValidManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  } catch (cause) {
    throw new Error(
      `Refusing to replace generated-looking entries because manifest.json is not a valid Gaussian sequence manifest: ${outputDir}`,
      { cause },
    );
  }
}

async function promoteStagedDataset(
  stagingDir: string,
  outputDir: string,
): Promise<void> {
  if (!(await exists(outputDir))) {
    await rename(stagingDir, outputDir);
    return;
  }

  const stagedEntries = await readdir(stagingDir);
  const unexpectedEntry = stagedEntries.find(
    (entry) =>
      !GENERATED_OUTPUT_ENTRIES.includes(
        entry as (typeof GENERATED_OUTPUT_ENTRIES)[number],
      ),
  );
  if (unexpectedEntry !== undefined) {
    throw new Error(
      `Dataset staging produced an unexpected top-level entry: ${unexpectedEntry}`,
    );
  }

  const backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
  await mkdir(backupDir, { recursive: false });
  const backedUpEntries: string[] = [];
  const promotedEntries: string[] = [];
  try {
    for (const entry of GENERATED_OUTPUT_ENTRIES) {
      const existingPath = join(outputDir, entry);
      if (await exists(existingPath)) {
        await rename(existingPath, join(backupDir, entry));
        backedUpEntries.push(entry);
      }
    }
    for (const entry of GENERATED_OUTPUT_ENTRIES) {
      const stagedPath = join(stagingDir, entry);
      if (await exists(stagedPath)) {
        await rename(stagedPath, join(outputDir, entry));
        promotedEntries.push(entry);
      }
    }
  } catch (error) {
    try {
      for (const entry of promotedEntries.reverse()) {
        await rm(join(outputDir, entry), { force: true, recursive: true });
      }
      for (const entry of backedUpEntries.reverse()) {
        await rename(join(backupDir, entry), join(outputDir, entry));
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error],
        `Dataset promotion failed and rollback was incomplete. Recovery files remain in ${backupDir}.`,
        { cause: rollbackError },
      );
    }
    await rm(backupDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }

  await rm(stagingDir, { force: true, recursive: true });
  await rm(backupDir, { force: true, recursive: true });
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
