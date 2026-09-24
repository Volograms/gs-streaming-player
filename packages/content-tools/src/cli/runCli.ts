import { buildDataset } from "../build-dataset/buildDataset.js";
import { runConvertManifestCli } from "../convert-manifest/runConvertManifestCli.js";
import { generateDynamicTiers } from "../dynamic-tiers/generateDynamicTiers.js";
import { runRadQualityCuts } from "../rad-cuts/runRadQualityCuts.js";
import { convertQualityCutsToSog } from "../sog/convertQualityCutsToSog.js";
import { exportStreamedSog } from "../sog/exportStreamedSog.js";
import { repackSpzV4 } from "../spz-v4/repackSpzV4.js";
import {
  countManifestFrames,
  validateManifestFile,
} from "../validate-manifest/validateManifestFile.js";

import type {
  BuildDatasetRequest,
  BuildDatasetRunner,
} from "../build-dataset/buildDataset.js";
import type {
  GenerateDynamicTiersRequest,
  GenerateDynamicTiersRunner,
} from "../dynamic-tiers/generateDynamicTiers.js";
import type {
  RadQualityCutsRequest,
  RadQualityCutsRunner,
} from "../rad-cuts/runRadQualityCuts.js";
import type {
  ConvertQualityCutsToSogRequest,
  ConvertQualityCutsToSogRunner,
} from "../sog/convertQualityCutsToSog.js";
import type {
  ExportStreamedSogRequest,
  ExportStreamedSogRunner,
} from "../sog/exportStreamedSog.js";
import type { RepackSpzV4Request, RepackSpzV4Runner } from "../spz-v4/repackSpzV4.js";

export interface CliIo {
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

const USAGE = `Usage:
  pnpm gs-content build <dataset-config.json> --output-dir <dir> [--frame-workers <n>] [--max-workers <n>] [--dry-run] [--force]
  pnpm gs-content generate-tiers <frame.ply|frame.spz> [more ...] --output-dir <dir> [options]
  pnpm gs-manifest validate <manifest.json> [--check-assets]
  pnpm gs-manifest convert-manifest <manifest.json> [--output <path>] [--regular-timing <true|false>] [--pretty] [--force]
  pnpm gs-content extract-rad-cuts <frame.rad> [more.rad ...] --output-dir <dir> [options] # legacy
  pnpm gs-content convert-sog <quality-cuts.json|scene.spz> --output-dir <dir> [options]
  pnpm gs-content export-sog-lod <scene.sog|source> --output-dir <dir> [options]
  pnpm gs-content repack-spz-v4 <quality-cuts.json> --output-dir <dir> --spz-tools-dir <dir> [--force]

Options:
  --regular-timing <true|false>
                  Converter timing mode; omitted detects exact regular timing per sequence.
  --pretty        Pretty-print converted JSON; default output is compact.
  --check-assets  Verify local files and remote URLs referenced by the manifest.
  --format <sog|spz>
                  Dynamic tier output format. Default: sog.
  --tiers <spec>  Ordered quality tiers as name=ratio pairs.
                  Default: preview=0.10,minimum=0.25,medium=0.50,full=1.00
  --minimum-playable <name>
                  Tier marked as minimum playable. Default: minimum.
  --frame-workers <n>
                  Frames processed concurrently; 0 chooses a CPU-aware value. Default: 0.
  --max-sh <0..3> Limit output spherical harmonics degree.
  --index <name>  Output metadata filename. Default: quality-cuts.json
  --sh-iterations <n>
                  SOG spherical-harmonic compression iterations. Default: 10.
  --max-workers <n>
                  SOG encoding worker threads; 0 runs inline. Default: 4.
  --lod-ratios <csv>
                  Streamed SOG detail ratios. Default: 1,0.5,0.25,0.1
  --lod-chunk-count <n>
                  Approximate Gaussians per spatial chunk in K. Default: 512.
  --lod-chunk-extent <n>
                  Approximate spatial chunk extent in world units. Default: 16.
  --force         Replace existing generated files.
  --help          Show this help.`;

export interface CliDependencies {
  buildDataset?: BuildDatasetRunner;
  convertQualityCutsToSog?: ConvertQualityCutsToSogRunner;
  exportStreamedSog?: ExportStreamedSogRunner;
  generateDynamicTiers?: GenerateDynamicTiersRunner;
  repackSpzV4?: RepackSpzV4Runner;
  runRadQualityCuts?: RadQualityCutsRunner;
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<number> {
  if (args.includes("--help") || args[0] === "help") {
    io.stdout(USAGE);
    return 0;
  }

  const command = args[0];
  if (command === "convert-manifest") return runConvertManifestCli(args.slice(1), io);
  if (command === "build") {
    const request = parseBuildDatasetRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.buildDataset ?? buildDataset)(request, io);
  }
  if (command === "generate-tiers") {
    const request = parseGenerateDynamicTiersRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.generateDynamicTiers ?? generateDynamicTiers)(request, io);
  }
  if (command === "extract-rad-cuts") {
    const request = parseRadQualityCutsRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.runRadQualityCuts ?? runRadQualityCuts)(request, io);
  }
  if (command === "repack-spz-v4") {
    const request = parseRepackSpzV4Request(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.repackSpzV4 ?? repackSpzV4)(request, io);
  }
  if (command === "convert-sog") {
    const request = parseConvertQualityCutsToSogRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.convertQualityCutsToSog ?? convertQualityCutsToSog)(
      request,
      io,
    );
  }
  if (command === "export-sog-lod") {
    const request = parseExportStreamedSogRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.exportStreamedSog ?? exportStreamedSog)(request, io);
  }

  const positional = args.slice(1).filter((argument) => !argument.startsWith("--"));
  const unknownFlags = args
    .slice(1)
    .filter((argument) => argument.startsWith("--") && argument !== "--check-assets");

  if (command !== "validate" || positional.length !== 1 || unknownFlags.length > 0) {
    if (unknownFlags.length > 0) {
      io.stderr(`Unknown option: ${unknownFlags.join(", ")}`);
    }
    io.stderr(USAGE);
    return 2;
  }

  const manifestPath = positional[0];
  if (manifestPath === undefined) {
    io.stderr(USAGE);
    return 2;
  }

  const result = await validateManifestFile(manifestPath, {
    checkAssets: args.includes("--check-assets"),
  });
  if (!result.valid) {
    io.stderr(`Manifest is invalid: ${manifestPath}`);
    for (const issue of result.issues) {
      io.stderr(`  ${issue.path} [${issue.code}] ${issue.message}`);
    }
    return 1;
  }

  io.stdout(`Manifest is valid: ${manifestPath}`);
  io.stdout(
    `  ${result.manifest.dynamicSequences.length} sequence(s), ${countManifestFrames(result.manifest)} frame(s)`,
  );
  return 0;
}

function parseBuildDatasetRequest(
  args: readonly string[],
  io: CliIo,
): BuildDatasetRequest | undefined {
  const request: BuildDatasetRequest = {
    configPath: "",
    dryRun: false,
    force: false,
    outputDir: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      if (request.configPath !== "") {
        io.stderr("build accepts exactly one dataset config.");
        io.stderr(USAGE);
        return undefined;
      }
      request.configPath = argument;
      continue;
    }
    if (argument === "--dry-run") {
      request.dryRun = true;
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    if (argument === "--output-dir") {
      request.outputDir = value;
      continue;
    }
    if (argument === "--frame-workers") {
      const frameWorkers = Number(value);
      if (!Number.isInteger(frameWorkers) || frameWorkers < 0) {
        io.stderr("--frame-workers must be a non-negative integer.");
        io.stderr(USAGE);
        return undefined;
      }
      request.frameWorkers = frameWorkers;
      continue;
    }
    if (argument === "--max-workers") {
      const maxWorkers = Number(value);
      if (!Number.isInteger(maxWorkers) || maxWorkers < 0) {
        io.stderr("--max-workers must be a non-negative integer.");
        io.stderr(USAGE);
        return undefined;
      }
      request.maxWorkers = maxWorkers;
      continue;
    }
    io.stderr(`Unknown option: ${argument}`);
    io.stderr(USAGE);
    return undefined;
  }
  if (request.configPath === "" || request.outputDir === "") {
    io.stderr("A dataset config and --output-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}

function parseGenerateDynamicTiersRequest(
  args: readonly string[],
  io: CliIo,
): GenerateDynamicTiersRequest | undefined {
  const request: GenerateDynamicTiersRequest = {
    frameWorkers: 0,
    force: false,
    inputPaths: [],
    maxWorkers: 4,
    minimumPlayable: "minimum",
    outputDir: "",
    outputFormat: "sog",
    shIterations: 10,
    tiers: { preview: 0.1, minimum: 0.25, medium: 0.5, full: 1 },
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) {
      request.inputPaths.push(argument);
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    switch (argument) {
      case "--frame-workers": {
        const frameWorkers = Number(value);
        if (!Number.isInteger(frameWorkers) || frameWorkers < 0) {
          io.stderr("--frame-workers must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.frameWorkers = frameWorkers;
        break;
      }
      case "--format":
        if (value !== "sog" && value !== "spz") {
          io.stderr("--format must be 'sog' or 'spz'.");
          io.stderr(USAGE);
          return undefined;
        }
        request.outputFormat = value;
        break;
      case "--max-sh": {
        const maxSh = Number(value);
        if (!Number.isInteger(maxSh) || maxSh < 0 || maxSh > 3) {
          io.stderr("--max-sh must be an integer between 0 and 3.");
          io.stderr(USAGE);
          return undefined;
        }
        request.maxSh = maxSh;
        break;
      }
      case "--max-workers": {
        const maxWorkers = Number(value);
        if (!Number.isInteger(maxWorkers) || maxWorkers < 0) {
          io.stderr("--max-workers must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.maxWorkers = maxWorkers;
        break;
      }
      case "--minimum-playable":
        request.minimumPlayable = value;
        break;
      case "--output-dir":
        request.outputDir = value;
        break;
      case "--sh-iterations": {
        const iterations = Number(value);
        if (!Number.isInteger(iterations) || iterations < 0) {
          io.stderr("--sh-iterations must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.shIterations = iterations;
        break;
      }
      case "--tiers": {
        const tiers = parseTierSpec(value);
        if (tiers === undefined) {
          io.stderr(
            "--tiers must contain comma-separated filesystem-safe name=ratio entries.",
          );
          io.stderr(USAGE);
          return undefined;
        }
        request.tiers = tiers;
        break;
      }
      default:
        io.stderr(`Unknown option: ${argument}`);
        io.stderr(USAGE);
        return undefined;
    }
  }

  if (request.inputPaths.length === 0 || request.outputDir === "") {
    io.stderr("At least one PLY or SPZ input and --output-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  if (!Object.hasOwn(request.tiers, request.minimumPlayable)) {
    io.stderr("--minimum-playable must name one of the configured tiers.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}

function parseTierSpec(value: string): Record<string, number> | undefined {
  const tiers: Record<string, number> = {};
  for (const entry of value.split(",")) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) return undefined;
    const name = entry.slice(0, separator).trim();
    const ratio = Number(entry.slice(separator + 1));
    if (
      !/^[a-zA-Z0-9_-]+$/.test(name) ||
      Object.hasOwn(tiers, name) ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio > 1
    ) {
      return undefined;
    }
    tiers[name] = ratio;
  }
  return Object.keys(tiers).length === 0 ? undefined : tiers;
}

function parseExportStreamedSogRequest(
  args: readonly string[],
  io: CliIo,
): ExportStreamedSogRequest | undefined {
  const request: ExportStreamedSogRequest = {
    force: false,
    inputPath: "",
    lodChunkCount: 512,
    lodChunkExtent: 16,
    lodRatios: [1, 0.5, 0.25, 0.1],
    maxWorkers: 4,
    outputDir: "",
    shIterations: 10,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      if (request.inputPath !== "") {
        io.stderr("export-sog-lod accepts exactly one source splat scene.");
        io.stderr(USAGE);
        return undefined;
      }
      request.inputPath = argument;
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    switch (argument) {
      case "--output-dir":
        request.outputDir = value;
        break;
      case "--lod-ratios": {
        const ratios = value.split(",").map(Number);
        if (
          ratios.length < 2 ||
          ratios[0] !== 1 ||
          ratios.some(
            (ratio, ratioIndex) =>
              !Number.isFinite(ratio) ||
              ratio <= 0 ||
              ratio > 1 ||
              (ratioIndex > 0 && ratio >= (ratios[ratioIndex - 1] ?? 0)),
          )
        ) {
          io.stderr(
            "--lod-ratios must start with 1 and contain strictly descending positive ratios.",
          );
          io.stderr(USAGE);
          return undefined;
        }
        request.lodRatios = ratios;
        break;
      }
      case "--lod-chunk-count": {
        const chunkCount = Number(value);
        if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
          io.stderr("--lod-chunk-count must be a positive integer in thousands.");
          io.stderr(USAGE);
          return undefined;
        }
        request.lodChunkCount = chunkCount;
        break;
      }
      case "--lod-chunk-extent": {
        const chunkExtent = Number(value);
        if (!Number.isFinite(chunkExtent) || chunkExtent <= 0) {
          io.stderr("--lod-chunk-extent must be a positive number.");
          io.stderr(USAGE);
          return undefined;
        }
        request.lodChunkExtent = chunkExtent;
        break;
      }
      case "--sh-iterations": {
        const iterations = Number(value);
        if (!Number.isInteger(iterations) || iterations < 0) {
          io.stderr("--sh-iterations must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.shIterations = iterations;
        break;
      }
      case "--max-workers": {
        const maxWorkers = Number(value);
        if (!Number.isInteger(maxWorkers) || maxWorkers < 0) {
          io.stderr("--max-workers must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.maxWorkers = maxWorkers;
        break;
      }
      default:
        io.stderr(`Unknown option: ${argument}`);
        io.stderr(USAGE);
        return undefined;
    }
  }

  if (request.inputPath === "" || request.outputDir === "") {
    io.stderr("A source splat scene and --output-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}

function parseConvertQualityCutsToSogRequest(
  args: readonly string[],
  io: CliIo,
): ConvertQualityCutsToSogRequest | undefined {
  const request: ConvertQualityCutsToSogRequest = {
    force: false,
    indexPath: "",
    maxWorkers: 4,
    outputDir: "",
    shIterations: 10,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      if (request.indexPath !== "") {
        io.stderr("convert-sog accepts exactly one quality-cuts index or SPZ scene.");
        io.stderr(USAGE);
        return undefined;
      }
      request.indexPath = argument;
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    switch (argument) {
      case "--output-dir":
        request.outputDir = value;
        break;
      case "--sh-iterations": {
        const iterations = Number(value);
        if (!Number.isInteger(iterations) || iterations < 0) {
          io.stderr("--sh-iterations must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.shIterations = iterations;
        break;
      }
      case "--max-workers": {
        const maxWorkers = Number(value);
        if (!Number.isInteger(maxWorkers) || maxWorkers < 0) {
          io.stderr("--max-workers must be a non-negative integer.");
          io.stderr(USAGE);
          return undefined;
        }
        request.maxWorkers = maxWorkers;
        break;
      }
      default:
        io.stderr(`Unknown option: ${argument}`);
        io.stderr(USAGE);
        return undefined;
    }
  }
  if (request.indexPath === "" || request.outputDir === "") {
    io.stderr("A quality-cuts index or SPZ scene and --output-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}

function parseRepackSpzV4Request(
  args: readonly string[],
  io: CliIo,
): RepackSpzV4Request | undefined {
  const request: RepackSpzV4Request = {
    force: false,
    indexPath: "",
    outputDir: "",
    spzToolsDir: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      if (request.indexPath !== "") {
        io.stderr("repack-spz-v4 accepts exactly one quality-cuts index.");
        io.stderr(USAGE);
        return undefined;
      }
      request.indexPath = argument;
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    if (argument === "--output-dir") {
      request.outputDir = value;
    } else if (argument === "--spz-tools-dir") {
      request.spzToolsDir = value;
    } else {
      io.stderr(`Unknown option: ${argument}`);
      io.stderr(USAGE);
      return undefined;
    }
  }
  if (
    request.indexPath === "" ||
    request.outputDir === "" ||
    request.spzToolsDir === ""
  ) {
    io.stderr("A quality-cuts index, --output-dir, and --spz-tools-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}

function parseRadQualityCutsRequest(
  args: readonly string[],
  io: CliIo,
): RadQualityCutsRequest | undefined {
  const request: RadQualityCutsRequest = {
    force: false,
    inputPaths: [],
    outputDir: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      request.inputPaths.push(argument);
      continue;
    }
    if (argument === "--force") {
      request.force = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      io.stderr(`Option ${argument} requires a value.`);
      io.stderr(USAGE);
      return undefined;
    }
    index += 1;
    switch (argument) {
      case "--index":
        request.indexFilename = value;
        break;
      case "--max-sh": {
        const maxSh = Number(value);
        if (!Number.isInteger(maxSh) || maxSh < 0 || maxSh > 3) {
          io.stderr("--max-sh must be an integer between 0 and 3.");
          io.stderr(USAGE);
          return undefined;
        }
        request.maxSh = maxSh;
        break;
      }
      case "--minimum-playable":
        request.minimumPlayable = value;
        break;
      case "--output-dir":
        request.outputDir = value;
        break;
      case "--tiers":
        request.tiers = value;
        break;
      default:
        io.stderr(`Unknown option: ${argument}`);
        io.stderr(USAGE);
        return undefined;
    }
  }

  if (request.inputPaths.length === 0 || request.outputDir.length === 0) {
    io.stderr("At least one input RAD and --output-dir are required.");
    io.stderr(USAGE);
    return undefined;
  }
  return request;
}
