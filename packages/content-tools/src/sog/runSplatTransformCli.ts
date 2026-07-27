import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export type SplatTransformCliRunner = (args: readonly string[]) => Promise<void>;

/** Runs the splat-transform version pinned by content-tools. */
export async function runSplatTransformCli(args: readonly string[]): Promise<void> {
  const libraryEntry = require.resolve("@playcanvas/splat-transform");
  const cliPath = resolve(dirname(libraryEntry), "../bin/cli.mjs");
  await execFileAsync(process.execPath, [cliPath, "--no-tty", "--quiet", ...args]);
}
