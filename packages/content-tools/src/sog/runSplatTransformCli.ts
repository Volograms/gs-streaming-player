import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export type SplatTransformCliRunner = (args: readonly string[]) => Promise<void>;
export type SplatTransformCliCaptureRunner = (
  args: readonly string[],
) => Promise<string>;

/** Runs the splat-transform version pinned by content-tools. */
export async function runSplatTransformCli(args: readonly string[]): Promise<void> {
  await executeSplatTransform(args);
}

/** Runs pinned splat-transform and returns its machine-readable standard output. */
export async function runSplatTransformCliCapture(
  args: readonly string[],
): Promise<string> {
  return (await executeSplatTransform(args)).stdout;
}

async function executeSplatTransform(args: readonly string[]) {
  const libraryEntry = require.resolve("@playcanvas/splat-transform");
  const cliPath = resolve(dirname(libraryEntry), "../bin/cli.mjs");
  return execFileAsync(process.execPath, [cliPath, "--no-tty", "--quiet", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}
