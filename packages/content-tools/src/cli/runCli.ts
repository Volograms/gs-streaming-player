import { runRadQualityCuts } from "../rad-cuts/runRadQualityCuts.js";
import {
  countManifestFrames,
  validateManifestFile,
} from "../validate-manifest/validateManifestFile.js";

import type {
  RadQualityCutsRequest,
  RadQualityCutsRunner,
} from "../rad-cuts/runRadQualityCuts.js";

export interface CliIo {
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

const USAGE = `Usage:
  pnpm gs-manifest validate <manifest.json> [--check-assets]
  pnpm gs-content extract-rad-cuts <frame.rad> [more.rad ...] --output-dir <dir> [options]

Options:
  --check-assets  Verify local files and remote URLs referenced by the manifest.
  --tiers <spec>  Ordered quality tiers as name=leaf-ratio pairs.
                  Default: preview=0.10,minimum=0.25,medium=0.50,full=1.00
  --minimum-playable <name>
                  Tier marked as minimum playable. Default: minimum.
  --max-sh <0..3> Limit output spherical harmonics degree.
  --index <name>  Output metadata filename. Default: quality-cuts.json
  --force         Replace existing generated files.
  --help          Show this help.`;

export interface CliDependencies {
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
  if (command === "extract-rad-cuts") {
    const request = parseRadQualityCutsRequest(args.slice(1), io);
    if (request === undefined) {
      return 2;
    }
    return (dependencies.runRadQualityCuts ?? runRadQualityCuts)(request, io);
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
