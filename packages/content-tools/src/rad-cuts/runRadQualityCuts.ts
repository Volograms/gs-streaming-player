import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliIo } from "../cli/runCli.js";

export interface RadQualityCutsRequest {
  force: boolean;
  indexFilename?: string;
  inputPaths: string[];
  maxSh?: number;
  minimumPlayable?: string;
  outputDir: string;
  tiers?: string;
}

export type RadQualityCutsRunner = (
  request: RadQualityCutsRequest,
  io: CliIo,
) => Promise<number>;

export async function runRadQualityCuts(
  request: RadQualityCutsRequest,
  io: CliIo,
): Promise<number> {
  const manifestPath = await findExtractorManifest();
  const extractorArgs = [
    ...request.inputPaths,
    "--output-dir",
    request.outputDir,
    ...(request.tiers === undefined ? [] : ["--tiers", request.tiers]),
    ...(request.minimumPlayable === undefined
      ? []
      : ["--minimum-playable", request.minimumPlayable]),
    ...(request.maxSh === undefined ? [] : ["--max-sh", String(request.maxSh)]),
    ...(request.indexFilename === undefined ? [] : ["--index", request.indexFilename]),
    ...(request.force ? ["--force"] : []),
  ];

  return new Promise<number>((resolveExitCode) => {
    const child = spawn(
      "cargo",
      ["run", "--release", "--manifest-path", manifestPath, "--", ...extractorArgs],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = createLineWriter(io.stdout);
    const stderr = createLineWriter(io.stderr);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", stdout.write);
    child.stderr.on("data", stderr.write);
    child.on("error", (cause) => {
      stderr.flush();
      stdout.flush();
      io.stderr(
        `Could not start the RAD quality-cut extractor: ${describeCause(cause)}`,
      );
      resolveExitCode(1);
    });
    child.on("close", (code, signal) => {
      stdout.flush();
      stderr.flush();
      if (signal !== null) {
        io.stderr(`RAD quality-cut extractor stopped by signal ${signal}.`);
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}

async function findExtractorManifest(): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "../../rust/rad-quality-cuts/Cargo.toml"),
    resolve(moduleDirectory, "../rust/rad-quality-cuts/Cargo.toml"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Source execution and bundled package execution have different module roots.
    }
  }
  throw new Error(
    `Could not locate rad-quality-cuts/Cargo.toml from ${moduleDirectory}.`,
  );
}

function createLineWriter(output: (message: string) => void) {
  let pending = "";
  return {
    flush: () => {
      if (pending.length > 0) {
        output(pending);
        pending = "";
      }
    },
    write: (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        output(line);
      }
    },
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
