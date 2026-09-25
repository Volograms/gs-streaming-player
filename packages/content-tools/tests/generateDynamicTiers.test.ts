import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { generateDynamicTiers } from "../src/dynamic-tiers/generateDynamicTiers.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    stderr,
    stdout,
  };
}

async function fixture(extension: "ply" | "spz" = "ply") {
  const root = await mkdtemp(join(tmpdir(), "dynamic-tiers-test-"));
  const inputPath = join(root, `frame0001.${extension}`);
  await writeFile(inputPath, "source");
  return { inputPath, outputDir: join(root, "output") };
}

function fakeDependencies(sourceCount = 100) {
  const calls: string[][] = [];
  return {
    calls,
    dependencies: {
      inspectSource: async (path: string) => ({
        gaussian: true,
        numGaussians: basename(path).includes("quarter") ? 25 : sourceCount,
      }),
      runSplatTransform: async (args: readonly string[]) => {
        calls.push([...args]);
        const outputPath = [...args]
          .reverse()
          .find((argument) => /\.(?:ply|sog|spz)$/i.test(argument));
        if (outputPath === undefined) throw new Error("missing fake output");
        await mkdir(join(outputPath, ".."), { recursive: true });
        await writeFile(outputPath, `generated:${basename(outputPath)}`);
      },
    },
  };
}

describe("generateDynamicTiers", () => {
  it("decimates a PLY and writes bundled SOG tiers with exact metadata", async () => {
    const input = await fixture("ply");
    const output = createIo();
    const fake = fakeDependencies();
    const exitCode = await generateDynamicTiers(
      {
        frameWorkers: 1,
        force: false,
        inputPaths: [input.inputPath],
        maxSh: 1,
        maxWorkers: 2,
        minimumPlayable: "quarter",
        outputDir: input.outputDir,
        outputFormat: "sog",
        shIterations: 6,
        tiers: { quarter: 0.25, full: 1 },
      },
      output.io,
      fake.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0]).toEqual(
      expect.arrayContaining(["--decimate-adaptive", "25%", "--filter-harmonics", "1"]),
    );
    expect(fake.calls[1]).toEqual(
      expect.arrayContaining(["--sh-iterations", "6", "--max-workers", "2"]),
    );
    const index = JSON.parse(
      await readFile(join(input.outputDir, "quality-cuts.json"), "utf8"),
    ) as {
      cutStrategy: string;
      format: string;
      frames: Array<{
        qualityLevels: Array<{
          codec: string;
          detailLevel: number;
          minimumPlayable: boolean;
          splatCount: number;
          url: string;
        }>;
      }>;
    };
    expect(index).toMatchObject({
      cutStrategy: "splat-transform-adaptive-decimation-v1",
      format: "flat-sog-quality-cuts",
    });
    expect(index.frames[0]?.qualityLevels).toMatchObject([
      {
        codec: "sog-v2",
        detailLevel: 0.25,
        minimumPlayable: true,
        splatCount: 25,
        url: "frame0001-quarter.sog",
      },
      {
        codec: "sog-v2",
        detailLevel: 1,
        minimumPlayable: false,
        splatCount: 100,
        url: "frame0001-full.sog",
      },
    ]);
  });

  it("accepts SPZ input and writes explicit SPZ v4 tiers", async () => {
    const input = await fixture("spz");
    const output = createIo();
    const fake = fakeDependencies();
    const exitCode = await generateDynamicTiers(
      {
        frameWorkers: 1,
        force: false,
        inputPaths: [input.inputPath],
        maxWorkers: 4,
        minimumPlayable: "full",
        outputDir: input.outputDir,
        outputFormat: "spz",
        shIterations: 10,
        tiers: { full: 1 },
      },
      output.io,
      fake.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual(expect.arrayContaining(["--spz-version", "4"]));
    const index = await readFile(join(input.outputDir, "quality-cuts.json"), "utf8");
    expect(index).toContain('"format": "flat-spz-quality-cuts"');
    expect(index).toContain('"codec": "spz-v4"');
  });

  it("processes frames concurrently while preserving manifest order", async () => {
    const root = await mkdtemp(join(tmpdir(), "dynamic-tiers-parallel-test-"));
    const inputPaths = ["frame1.ply", "frame2.ply", "frame3.ply"].map((name) =>
      join(root, name),
    );
    await Promise.all(inputPaths.map((path) => writeFile(path, "source")));
    const outputDir = join(root, "output");
    const output = createIo();
    let active = 0;
    let maximumActive = 0;

    const exitCode = await generateDynamicTiers(
      {
        frameWorkers: 2,
        force: false,
        inputPaths,
        maxWorkers: 1,
        minimumPlayable: "full",
        outputDir,
        outputFormat: "spz",
        shIterations: 10,
        tiers: { full: 1 },
      },
      output.io,
      {
        inspectSource: async () => ({ gaussian: true, numGaussians: 100 }),
        runSplatTransform: async (args) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          const outputPath = [...args]
            .reverse()
            .find((argument) => /\.spz$/i.test(argument));
          if (outputPath === undefined) throw new Error("missing fake output");
          await mkdir(join(outputPath, ".."), { recursive: true });
          await writeFile(outputPath, "generated");
          active -= 1;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(maximumActive).toBe(2);
    const index = JSON.parse(
      await readFile(join(outputDir, "quality-cuts.json"), "utf8"),
    ) as { frames: Array<{ sourceFile: string }> };
    expect(index.frames.map(({ sourceFile }) => sourceFile)).toEqual([
      "frame1.ply",
      "frame2.ply",
      "frame3.ply",
    ]);
  });

  it("rejects RAD input on the public tier-generation path", async () => {
    const root = await mkdtemp(join(tmpdir(), "dynamic-tiers-rad-test-"));
    const inputPath = join(root, "frame.rad");
    await writeFile(inputPath, "rad");
    const output = createIo();
    const exitCode = await generateDynamicTiers(
      {
        frameWorkers: 1,
        force: false,
        inputPaths: [inputPath],
        maxWorkers: 4,
        minimumPlayable: "full",
        outputDir: join(root, "output"),
        outputFormat: "sog",
        shIterations: 10,
        tiers: { full: 1 },
      },
      output.io,
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain("must be PLY or SPZ");
  });

  it("protects existing output and does not invoke conversion", async () => {
    const input = await fixture();
    await mkdir(input.outputDir);
    await writeFile(join(input.outputDir, "quality-cuts.json"), "existing");
    const output = createIo();
    const runSplatTransform = vi.fn(async () => undefined);
    const exitCode = await generateDynamicTiers(
      {
        frameWorkers: 1,
        force: false,
        inputPaths: [input.inputPath],
        maxWorkers: 4,
        minimumPlayable: "full",
        outputDir: input.outputDir,
        outputFormat: "sog",
        shIterations: 10,
        tiers: { full: 1 },
      },
      output.io,
      {
        inspectSource: async () => ({ gaussian: true, numGaussians: 100 }),
        runSplatTransform,
      },
    );

    expect(exitCode).toBe(1);
    expect(runSplatTransform).not.toHaveBeenCalled();
    expect(output.stderr.join("\n")).toContain("already exists");
    await expect(
      access(join(input.outputDir, "quality-cuts.json")),
    ).resolves.toBeUndefined();
  });
});
