import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { convertQualityCutsToSog } from "../src/sog/convertQualityCutsToSog.js";

import type {
  ConvertQualityCutsToSogIo,
  SogAssetConversionRequest,
} from "../src/sog/convertQualityCutsToSog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function createIo(): {
  io: ConvertQualityCutsToSogIo;
  stderr: string[];
  stdout: string[];
} {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    io: {
      stderr: (message) => stderr.push(message),
      stdout: (message) => stdout.push(message),
    },
    stderr,
    stdout,
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gs-sog-test-"));
  temporaryDirectories.push(path);
  return path;
}

describe("convertQualityCutsToSog", () => {
  it("converts unique local tiers and preserves index metadata", async () => {
    const root = await createTemporaryDirectory();
    const inputDir = join(root, "input");
    const outputDir = join(root, "output");
    await mkdir(join(inputDir, "tiers"), { recursive: true });
    await Promise.all([
      writeFile(join(inputDir, "tiers", "frame1-minimum.spz"), "minimum"),
      writeFile(join(inputDir, "tiers", "frame1-full.spz"), "full"),
    ]);
    await writeFile(
      join(inputDir, "quality-cuts.json"),
      JSON.stringify({
        cutStrategy: "preserve-this",
        format: "flat-spz-quality-cuts",
        frames: [
          {
            frameMetadata: { source: "RAD" },
            qualityLevels: [
              {
                byteSize: 123,
                codec: "spz-v4",
                level: 0,
                metadata: { tier: "minimum", untouched: true },
                minimumPlayable: true,
                splatCount: 25,
                url: "tiers/frame1-minimum.spz",
              },
              {
                byteSize: 456,
                level: 1,
                metadata: { tier: "full" },
                minimumPlayable: false,
                splatCount: 100,
                url: "tiers/frame1-full.spz",
              },
            ],
          },
          {
            qualityLevels: [
              {
                level: 0,
                metadata: { tier: "minimum" },
                url: "tiers/frame1-minimum.spz",
              },
            ],
          },
        ],
        version: 1,
      }),
    );

    const requests: SogAssetConversionRequest[] = [];
    const output = createIo();
    const exitCode = await convertQualityCutsToSog(
      {
        force: false,
        indexPath: join(inputDir, "quality-cuts.json"),
        maxWorkers: 2,
        outputDir,
        shIterations: 7,
      },
      output.io,
      {
        convertAsset: async (request) => {
          requests.push(request);
          await writeFile(
            request.outputPath,
            new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
          );
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ maxWorkers: 2, shIterations: 7 });
    const converted = JSON.parse(
      await readFile(join(outputDir, "quality-cuts.json"), "utf8"),
    ) as {
      cutStrategy: string;
      format: string;
      frames: Array<{
        frameMetadata?: { source: string };
        qualityLevels: Array<Record<string, unknown>>;
      }>;
    };
    expect(converted.format).toBe("flat-sog-quality-cuts");
    expect(converted.cutStrategy).toBe("preserve-this");
    expect(converted.frames[0]?.frameMetadata).toEqual({ source: "RAD" });
    expect(converted.frames[0]?.qualityLevels[0]).toMatchObject({
      byteSize: 7,
      codec: "sog-v2",
      level: 0,
      metadata: { format: "sog", tier: "minimum", untouched: true },
      minimumPlayable: true,
      splatCount: 25,
      url: "tiers/frame1-minimum.sog",
    });
  });

  it("rejects remote SPZ tiers before invoking the converter", async () => {
    const root = await createTemporaryDirectory();
    const indexPath = join(root, "quality-cuts.json");
    await writeFile(
      indexPath,
      JSON.stringify({
        format: "flat-spz-quality-cuts",
        frames: [
          {
            qualityLevels: [{ url: "https://cdn.example.test/frame1-minimum.spz" }],
          },
        ],
        version: 1,
      }),
    );
    let calls = 0;
    const output = createIo();

    const exitCode = await convertQualityCutsToSog(
      {
        force: false,
        indexPath,
        maxWorkers: 4,
        outputDir: join(root, "output"),
        shIterations: 10,
      },
      output.io,
      {
        convertAsset: async () => {
          calls += 1;
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(calls).toBe(0);
    expect(output.stderr.join("\n")).toContain("Remote SPZ tier sources");
  });

  it("rejects malformed quality indexes", async () => {
    const root = await createTemporaryDirectory();
    const indexPath = join(root, "quality-cuts.json");
    await writeFile(
      indexPath,
      JSON.stringify({ format: "other", frames: [], version: 1 }),
    );
    const output = createIo();

    const exitCode = await convertQualityCutsToSog(
      {
        force: false,
        indexPath,
        maxWorkers: 4,
        outputDir: join(root, "output"),
        shIterations: 10,
      },
      output.io,
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain("flat SPZ quality-cuts");
  });
});
