import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli/runCli.js";

import type { CliIo } from "../src/cli/runCli.js";

const validManifestPath = resolve(
  fileURLToPath(
    new URL("../../../test-data/manifests/minimal-valid.json", import.meta.url),
  ),
);
const invalidManifestPath = resolve(
  fileURLToPath(
    new URL("../../../test-data/manifests/invalid-timeline.json", import.meta.url),
  ),
);

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stderr: (message) => stderr.push(message),
    stdout: (message) => stdout.push(message),
  };
  return { io, stderr, stdout };
}

describe("gs-manifest CLI", () => {
  it("returns zero for a valid manifest", async () => {
    const output = createIo();
    const exitCode = await runCli(["validate", validManifestPath], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("3 frame(s)");
    expect(output.stderr).toEqual([]);
  });

  it("returns non-zero and prints exact paths for invalid content", async () => {
    const output = createIo();
    const exitCode = await runCli(["validate", invalidManifestPath], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "/dynamicSequences/0/frames/1/frameIndex",
    );
  });

  it("returns a usage error for unsupported arguments", async () => {
    const output = createIo();
    const exitCode = await runCli(["create"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stderr.join("\n")).toContain("Usage:");
  });

  it("forwards RAD quality-cut options to the extractor", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "extract-rad-cuts",
        "frame0040-lod.rad",
        "frame0041-lod.rad",
        "--output-dir",
        "generated",
        "--tiers",
        "base=0.25,full=1",
        "--minimum-playable",
        "base",
        "--max-sh",
        "1",
        "--force",
      ],
      output.io,
      {
        runRadQualityCuts: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: true,
        inputPaths: ["frame0040-lod.rad", "frame0041-lod.rad"],
        maxSh: 1,
        minimumPlayable: "base",
        outputDir: "generated",
        tiers: "base=0.25,full=1",
      },
    ]);
  });

  it("requires an output directory for RAD quality cuts", async () => {
    const output = createIo();
    const exitCode = await runCli(["extract-rad-cuts", "frame0040-lod.rad"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stderr.join("\n")).toContain("--output-dir");
  });

  it("forwards SPZ v4 repacking options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "repack-spz-v4",
        "cuts/quality-cuts.json",
        "--output-dir",
        "cuts-v4",
        "--spz-tools-dir",
        "/opt/spz/build-native",
        "--force",
      ],
      output.io,
      {
        repackSpzV4: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: true,
        indexPath: "cuts/quality-cuts.json",
        outputDir: "cuts-v4",
        spzToolsDir: "/opt/spz/build-native",
      },
    ]);
  });

  it("requires the SPZ v4 output and tool directories", async () => {
    const output = createIo();
    const exitCode = await runCli(
      ["repack-spz-v4", "cuts/quality-cuts.json"],
      output.io,
    );

    expect(exitCode).toBe(2);
    expect(output.stderr.join("\n")).toContain("--spz-tools-dir");
  });
});
