import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exportStreamedSog } from "../src/sog/exportStreamedSog.js";

import type { ExportStreamedSogRequest } from "../src/sog/exportStreamedSog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "streamed-sog-test-"));
  temporaryDirectories.push(root);
  const inputPath = join(root, "scene.sog");
  const outputDir = join(root, "output");
  await writeFile(inputPath, "source");
  const request: ExportStreamedSogRequest = {
    force: false,
    inputPath,
    lodChunkCount: 512,
    lodChunkExtent: 16,
    lodRatios: [1, 0.5, 0.25, 0.1],
    maxWorkers: 2,
    outputDir,
    shIterations: 7,
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    outputDir,
    request,
    stderr,
    stdout,
  };
}

describe("exportStreamedSog", () => {
  it("decimates coarse levels and tags every level in the final export", async () => {
    const fixture = await createFixture();
    const calls: string[][] = [];
    const exitCode = await exportStreamedSog(fixture.request, fixture.io, {
      runSplatTransform: async (args) => {
        calls.push([...args]);
        const indexPath = args.find((argument) => argument.endsWith("lod-meta.json"));
        if (indexPath !== undefined) {
          await mkdir(dirname(indexPath), { recursive: true });
          await writeFile(
            indexPath,
            `${JSON.stringify({
              counts: [100, 50, 25, 10],
              filenames: ["0_0/meta.json"],
              lodLevels: 4,
              tree: {},
              version: 1,
            })}\n`,
          );
          return;
        }
        const outputPath = [...args]
          .reverse()
          .find((argument) => argument.endsWith(".ply"));
        if (outputPath === undefined) {
          throw new Error("test runner did not receive a PLY output");
        }
        await writeFile(outputPath, "ply");
      },
    });

    expect(exitCode).toBe(0);
    expect(fixture.stderr).toEqual([]);
    expect(calls).toHaveLength(5);
    expect(calls[0]?.some((argument) => argument.endsWith("lod-0.ply"))).toBe(true);
    expect(calls.slice(1, 4).map((args) => args[2])).toEqual(["50%", "25%", "10%"]);
    for (const args of calls.slice(1, 4)) {
      expect(args).toContain("--scratch-dir");
    }

    const exportArgs = calls[4] ?? [];
    expect(exportArgs.slice(0, 4)).toEqual([
      "--lod-chunk-count",
      "512",
      "--lod-chunk-extent",
      "16",
    ]);
    expect(exportArgs.filter((argument) => argument === "--tag-lod")).toHaveLength(4);
    expect(exportArgs).toContain("0");
    expect(exportArgs).toContain("1");
    expect(exportArgs).toContain("2");
    expect(exportArgs).toContain("3");
    expect(exportArgs).toContain("--sh-iterations");
    expect(exportArgs).toContain("--max-workers");
    await expect(
      access(join(fixture.outputDir, "lod-meta.json")),
    ).resolves.toBeUndefined();
    expect(await readFile(join(fixture.outputDir, "lod-meta.json"), "utf8")).toContain(
      '"lodLevels":4',
    );
  });

  it("protects an existing output index", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.outputDir, { recursive: true });
    await writeFile(join(fixture.outputDir, "lod-meta.json"), "{}\n");
    let calls = 0;

    const exitCode = await exportStreamedSog(fixture.request, fixture.io, {
      runSplatTransform: async () => {
        calls += 1;
      },
    });

    expect(exitCode).toBe(1);
    expect(calls).toBe(0);
    expect(fixture.stderr.join("\n")).toContain("already exists");
  });

  it("rejects a single-level export because it would not be a real LOD tree", async () => {
    const fixture = await createFixture();
    const exitCode = await exportStreamedSog(
      { ...fixture.request, lodRatios: [1] },
      fixture.io,
    );

    expect(exitCode).toBe(1);
    expect(fixture.stderr.join("\n")).toContain("at least one coarse level");
  });
});
