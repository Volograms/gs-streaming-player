import {
  countManifestFrames,
  validateManifestFile,
} from "../validate-manifest/validateManifestFile.js";

export interface CliIo {
  stderr: (message: string) => void;
  stdout: (message: string) => void;
}

const USAGE = `Usage:
  pnpm gs-manifest validate <manifest.json> [--check-assets]

Options:
  --check-assets  Verify local files and remote URLs referenced by the manifest.
  --help          Show this help.`;

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args[0] === "help") {
    io.stdout(USAGE);
    return 0;
  }

  const command = args[0];
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
