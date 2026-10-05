import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import {
  runSplatTransformCli,
  runSplatTransformCliCapture,
} from "../sog/runSplatTransformCli.js";

import type { CliIo } from "../cli/runCli.js";
import type { SplatTransformCliRunner } from "../sog/runSplatTransformCli.js";

export type DynamicTierOutputFormat = "sog" | "spz";

export interface GenerateDynamicTiersRequest {
  frameWorkers: number;
  force: boolean;
  inputPaths: string[];
  maxSh?: number;
  maxWorkers: number;
  minimumPlayable: string;
  outputDir: string;
  outputFormat: DynamicTierOutputFormat;
  shIterations: number;
  tiers: Record<string, number>;
}

export interface SplatSourceInfo {
  gaussian: boolean;
  numGaussians: number;
}

export interface GenerateDynamicTiersDependencies {
  inspectSource?: (inputPath: string) => Promise<SplatSourceInfo>;
  runSplatTransform?: SplatTransformCliRunner;
}

export type GenerateDynamicTiersRunner = (
  request: GenerateDynamicTiersRequest,
  io: CliIo,
) => Promise<number>;

interface GeneratedQualityLevel {
  byteSize: number;
  codec: "sog-v2" | "spz-v4";
  detailLevel: number;
  level: number;
  metadata: {
    format: DynamicTierOutputFormat;
    sourceFormat: "ply" | "spz";
    strategy: "splat-transform-adaptive-decimation-v1";
    targetRatio: number;
    tier: string;
  };
  minimumPlayable: boolean;
  splatCount: number;
  url: string;
}

interface GeneratedFrame {
  qualityLevels: GeneratedQualityLevel[];
  sourceFile: string;
}

interface PlannedOutput {
  filename: string;
  path: string;
  ratio: number;
  tier: string;
}

interface PlannedFrame {
  inputPath: string;
  outputs: PlannedOutput[];
  sourceFormat: "ply" | "spz";
}

/** Generates flat temporal quality tiers from ordinary PLY or SPZ frame sources. */
export async function generateDynamicTiers(
  request: GenerateDynamicTiersRequest,
  io: CliIo,
  dependencies: GenerateDynamicTiersDependencies = {},
): Promise<number> {
  let temporaryDir: string | undefined;
  try {
    const tiers = validateRequest(request);
    const inputPaths = request.inputPaths.map((path) => resolve(path));
    const outputDir = resolve(request.outputDir);
    const indexPath = join(outputDir, "quality-cuts.json");
    const runSplatTransform = dependencies.runSplatTransform ?? runSplatTransformCli;
    const inspectSource = dependencies.inspectSource ?? inspectSplatSource;

    await Promise.all(inputPaths.map((path) => access(path)));
    const framePlans = planFrames(inputPaths, outputDir, tiers, request.outputFormat);
    const generatedPaths = [
      indexPath,
      ...framePlans.flatMap((frame) => frame.outputs.map((output) => output.path)),
    ];
    if (!request.force) {
      for (const path of generatedPaths) {
        if (await exists(path)) {
          throw new Error(`Output already exists: ${path}`);
        }
      }
    }

    await mkdir(outputDir, { recursive: true });
    const workingDir = await mkdtemp(join(tmpdir(), "gs-dynamic-tiers-"));
    temporaryDir = workingDir;
    const frameWorkers = resolveFrameWorkers(request);
    io.stdout(
      `Generating ${framePlans.length} frame(s) with ${frameWorkers} parallel frame worker(s).`,
    );
    const frames = await mapConcurrentOrdered(
      framePlans,
      frameWorkers,
      async (frame, frameIndex) =>
        generateFrame(
          request,
          frame,
          frameIndex,
          framePlans.length,
          workingDir,
          inspectSource,
          runSplatTransform,
          io,
        ),
    );

    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          cutStrategy: "splat-transform-adaptive-decimation-v1",
          format:
            request.outputFormat === "sog"
              ? "flat-sog-quality-cuts"
              : "flat-spz-quality-cuts",
          frames,
          minimumPlayableTier: request.minimumPlayable,
          version: 1,
        },
        null,
        2,
      )}\n`,
    );
    io.stdout(`Wrote ${frames.length} frame tier set(s) and ${indexPath}`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (temporaryDir !== undefined) {
      await rm(temporaryDir, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

export async function inspectSplatSource(inputPath: string): Promise<SplatSourceInfo> {
  const stdout = await runSplatTransformCliCapture([
    resolve(inputPath),
    "--info",
    "json",
    "null",
  ]);
  const value = JSON.parse(stdout) as unknown;
  if (
    !isRecord(value) ||
    typeof value.gaussian !== "boolean" ||
    !Number.isInteger(value.numGaussians)
  ) {
    throw new Error(
      `SplatTransform returned invalid source metadata for ${inputPath}.`,
    );
  }
  return {
    gaussian: value.gaussian,
    numGaussians: value.numGaussians as number,
  };
}

function validateRequest(
  request: GenerateDynamicTiersRequest,
): Array<[name: string, ratio: number]> {
  if (request.inputPaths.length === 0) {
    throw new Error("At least one PLY or SPZ input frame is required.");
  }
  for (const path of request.inputPaths) {
    const extension = extname(path).toLowerCase();
    if (extension !== ".ply" && extension !== ".spz") {
      throw new Error(`Dynamic input must be PLY or SPZ: ${path}`);
    }
  }
  if (request.outputFormat !== "sog" && request.outputFormat !== "spz") {
    throw new Error("Dynamic output format must be 'sog' or 'spz'.");
  }
  if (
    request.maxSh !== undefined &&
    (!Number.isInteger(request.maxSh) || request.maxSh < 0 || request.maxSh > 3)
  ) {
    throw new Error("Maximum SH degree must be an integer between 0 and 3.");
  }
  if (!Number.isInteger(request.shIterations) || request.shIterations < 0) {
    throw new Error("SOG SH iterations must be a non-negative integer.");
  }
  if (!Number.isInteger(request.maxWorkers) || request.maxWorkers < 0) {
    throw new Error("SOG max workers must be a non-negative integer.");
  }
  if (!Number.isInteger(request.frameWorkers) || request.frameWorkers < 0) {
    throw new Error("Frame workers must be a non-negative integer.");
  }
  const tiers = Object.entries(request.tiers);
  if (
    tiers.length === 0 ||
    tiers.some(
      ([name, ratio]) =>
        name.trim() === "" ||
        !/^[a-zA-Z0-9_-]+$/.test(name) ||
        !Number.isFinite(ratio) ||
        ratio <= 0 ||
        ratio > 1,
    )
  ) {
    throw new Error(
      "Dynamic tiers require filesystem-safe names and ratios above zero and at most one.",
    );
  }
  if (!Object.hasOwn(request.tiers, request.minimumPlayable)) {
    throw new Error(
      `Minimum playable tier '${request.minimumPlayable}' is not present in dynamic tiers.`,
    );
  }
  return tiers;
}

function planFrames(
  inputPaths: readonly string[],
  outputDir: string,
  tiers: ReadonlyArray<readonly [string, number]>,
  outputFormat: DynamicTierOutputFormat,
): PlannedFrame[] {
  const names = new Set<string>();
  return inputPaths.map((inputPath) => {
    const sourceFilename = basename(inputPath);
    const sourceFormat = extname(inputPath).toLowerCase() === ".spz" ? "spz" : "ply";
    const stem = sourceFilename.slice(0, -extname(sourceFilename).length);
    const outputs = tiers.map(([tier, ratio]) => {
      const filename = `${stem}-${tier}.${outputFormat}`;
      if (!names.add(filename.toLowerCase())) {
        throw new Error(`Dynamic inputs would write the same tier file: ${filename}`);
      }
      return { filename, path: join(outputDir, filename), ratio, tier };
    });
    return { inputPath, outputs, sourceFormat };
  });
}

async function generateFrame(
  request: GenerateDynamicTiersRequest,
  frame: PlannedFrame,
  frameIndex: number,
  frameCount: number,
  temporaryDir: string,
  inspectSource: (inputPath: string) => Promise<SplatSourceInfo>,
  runSplatTransform: SplatTransformCliRunner,
  io: CliIo,
): Promise<GeneratedFrame> {
  const frameLabel = `[${frameIndex + 1}/${frameCount}] ${basename(frame.inputPath)}`;
  const sourceInfo = await inspectSource(frame.inputPath);
  if (!sourceInfo.gaussian || sourceInfo.numGaussians <= 0) {
    throw new Error(`Input is not Gaussian splat data: ${frame.inputPath}`);
  }
  io.stdout(`${frameLabel}: ${sourceInfo.numGaussians} source Gaussians`);
  const qualityLevels: GeneratedQualityLevel[] = [];

  for (const [level, output] of frame.outputs.entries()) {
    let encodingInput = frame.inputPath;
    if (output.ratio < 1) {
      const temporaryPly = join(
        temporaryDir,
        `${frameIndex}-${level}-${output.tier}.ply`,
      );
      io.stdout(
        `${frameLabel} ${output.tier}: decimating to ${formatPercent(output.ratio)}`,
      );
      await runSplatTransform([
        frame.inputPath,
        ...(request.maxSh === undefined
          ? []
          : ["--filter-harmonics", String(request.maxSh)]),
        "--decimate-adaptive",
        formatPercent(output.ratio),
        "--scratch-dir",
        temporaryDir,
        temporaryPly,
      ]);
      await access(temporaryPly);
      encodingInput = temporaryPly;
    }

    io.stdout(
      `${frameLabel} ${output.tier}: writing ${request.outputFormat.toUpperCase()}`,
    );
    await runSplatTransform([
      encodingInput,
      ...(output.ratio === 1 && request.maxSh !== undefined
        ? ["--filter-harmonics", String(request.maxSh)]
        : []),
      output.path,
      ...(request.outputFormat === "sog"
        ? [
            "--sh-iterations",
            String(request.shIterations),
            "--max-workers",
            String(request.maxWorkers),
          ]
        : ["--spz-version", "4"]),
      ...(request.force ? ["--overwrite"] : []),
    ]);
    await access(output.path);
    const outputInfo = await inspectSource(output.path);
    if (!outputInfo.gaussian || outputInfo.numGaussians <= 0) {
      throw new Error(`Generated tier is not Gaussian splat data: ${output.path}`);
    }
    const byteSize = (await stat(output.path)).size;
    qualityLevels.push({
      byteSize,
      codec: request.outputFormat === "sog" ? "sog-v2" : "spz-v4",
      detailLevel: outputInfo.numGaussians / sourceInfo.numGaussians,
      level,
      metadata: {
        format: request.outputFormat,
        sourceFormat: frame.sourceFormat,
        strategy: "splat-transform-adaptive-decimation-v1",
        targetRatio: output.ratio,
        tier: output.tier,
      },
      minimumPlayable: output.tier === request.minimumPlayable,
      splatCount: outputInfo.numGaussians,
      url: output.filename,
    });
  }

  return { qualityLevels, sourceFile: basename(frame.inputPath) };
}

function resolveFrameWorkers(request: GenerateDynamicTiersRequest): number {
  if (request.frameWorkers > 0) return request.frameWorkers;
  const encoderWorkers =
    request.outputFormat === "sog" ? Math.max(1, request.maxWorkers) : 1;
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / encoderWorkers)));
}

async function mapConcurrentOrdered<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  map: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    async () => {
      while (firstError === undefined) {
        const index = nextIndex;
        nextIndex += 1;
        const input = inputs[index];
        if (input === undefined) return;
        try {
          outputs[index] = await map(input, index);
        } catch (error) {
          firstError ??= error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return outputs;
}

function formatPercent(ratio: number): string {
  return `${Number((ratio * 100).toPrecision(12))}%`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
