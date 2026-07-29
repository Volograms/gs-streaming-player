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
  it("forwards config-driven dataset build options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "build",
        "content/dataset.json",
        "--output-dir",
        "public/content",
        "--dry-run",
        "--force",
      ],
      output.io,
      {
        buildDataset: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        configPath: "content/dataset.json",
        dryRun: true,
        force: true,
        outputDir: "public/content",
      },
    ]);
  });

  it("forwards public PLY/SPZ tier generation options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "generate-tiers",
        "frames/0001.ply",
        "frames/0002.spz",
        "--output-dir",
        "generated",
        "--format",
        "spz",
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
        generateDynamicTiers: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: true,
        inputPaths: ["frames/0001.ply", "frames/0002.spz"],
        maxSh: 1,
        maxWorkers: 4,
        minimumPlayable: "base",
        outputDir: "generated",
        outputFormat: "spz",
        shIterations: 10,
        tiers: { base: 0.25, full: 1 },
      },
    ]);
  });

  it("uses recommended tier-generation defaults and rejects invalid formats", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    expect(
      await runCli(
        ["generate-tiers", "frame.ply", "--output-dir", "generated"],
        output.io,
        {
          generateDynamicTiers: async (request) => {
            requests.push(request);
            return 0;
          },
        },
      ),
    ).toBe(0);
    expect(requests).toEqual([
      expect.objectContaining({
        minimumPlayable: "minimum",
        outputFormat: "sog",
        tiers: { preview: 0.1, minimum: 0.25, medium: 0.5, full: 1 },
      }),
    ]);

    const invalid = createIo();
    expect(
      await runCli(
        ["generate-tiers", "frame.ply", "--output-dir", "generated", "--format", "rad"],
        invalid.io,
      ),
    ).toBe(2);
    expect(invalid.stderr.join("\n")).toContain("'sog' or 'spz'");
  });

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

  it("keeps the legacy RAD quality-cut command available", async () => {
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

  it("forwards SOG conversion options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "convert-sog",
        "cuts/quality-cuts.json",
        "--output-dir",
        "cuts-sog",
        "--sh-iterations",
        "6",
        "--max-workers",
        "2",
        "--force",
      ],
      output.io,
      {
        convertQualityCutsToSog: async (request) => {
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
        maxWorkers: 2,
        outputDir: "cuts-sog",
        shIterations: 6,
      },
    ]);
  });

  it("uses documented SOG defaults and validates numeric options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      ["convert-sog", "cuts/quality-cuts.json", "--output-dir", "cuts-sog"],
      output.io,
      {
        convertQualityCutsToSog: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: false,
        indexPath: "cuts/quality-cuts.json",
        maxWorkers: 4,
        outputDir: "cuts-sog",
        shIterations: 10,
      },
    ]);

    const invalidOutput = createIo();
    expect(
      await runCli(
        [
          "convert-sog",
          "cuts/quality-cuts.json",
          "--output-dir",
          "cuts-sog",
          "--max-workers",
          "-1",
        ],
        invalidOutput.io,
      ),
    ).toBe(2);
    expect(invalidOutput.stderr.join("\n")).toContain("non-negative integer");
  });

  it("accepts a standalone SPZ scene for SOG conversion", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      ["convert-sog", "static/environment.spz", "--output-dir", "static-sog"],
      output.io,
      {
        convertQualityCutsToSog: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: false,
        indexPath: "static/environment.spz",
        maxWorkers: 4,
        outputDir: "static-sog",
        shIterations: 10,
      },
    ]);
  });

  it("forwards Streamed SOG LOD export options", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      [
        "export-sog-lod",
        "static/environment.sog",
        "--output-dir",
        "static-lod",
        "--lod-ratios",
        "1,0.4,0.1",
        "--lod-chunk-count",
        "256",
        "--lod-chunk-extent",
        "8",
        "--sh-iterations",
        "6",
        "--max-workers",
        "2",
        "--force",
      ],
      output.io,
      {
        exportStreamedSog: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: true,
        inputPath: "static/environment.sog",
        lodChunkCount: 256,
        lodChunkExtent: 8,
        lodRatios: [1, 0.4, 0.1],
        maxWorkers: 2,
        outputDir: "static-lod",
        shIterations: 6,
      },
    ]);
  });

  it("uses real multi-level Streamed SOG defaults and rejects invalid ratios", async () => {
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await runCli(
      ["export-sog-lod", "static/environment.sog", "--output-dir", "static-lod"],
      output.io,
      {
        exportStreamedSog: async (request) => {
          requests.push(request);
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      {
        force: false,
        inputPath: "static/environment.sog",
        lodChunkCount: 512,
        lodChunkExtent: 16,
        lodRatios: [1, 0.5, 0.25, 0.1],
        maxWorkers: 4,
        outputDir: "static-lod",
        shIterations: 10,
      },
    ]);

    const invalidOutput = createIo();
    expect(
      await runCli(
        [
          "export-sog-lod",
          "static/environment.sog",
          "--output-dir",
          "static-lod",
          "--lod-ratios",
          "1,0.25,0.5",
        ],
        invalidOutput.io,
      ),
    ).toBe(2);
    expect(invalidOutput.stderr.join("\n")).toContain("strictly descending");
  });
});
