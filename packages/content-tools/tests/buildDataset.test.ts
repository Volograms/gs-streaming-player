import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildDataset } from "../src/build-dataset/buildDataset.js";

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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gs-content-build-"));
  const inputDir = join(root, "inputs");
  await mkdir(inputDir);
  await writeFile(join(inputDir, "frame0001-lod.rad"), "rad-one");
  await writeFile(join(inputDir, "frame0002-lod.rad"), "rad-two");
  await writeFile(join(inputDir, "room.sog"), "static");
  await writeFile(join(inputDir, "track.ogg"), "audio");
  const configPath = join(root, "dataset.json");
  await writeFile(
    configPath,
    JSON.stringify({
      audio: { contentType: "audio/ogg", input: "inputs/track.ogg" },
      dynamic: {
        frames: ["inputs/frame0001-lod.rad", "inputs/frame0002-lod.rad"],
        id: "actor",
        minimumPlayable: "minimum",
      },
      frameRate: 30,
      id: "public-sample",
      staticObjects: [{ id: "room", input: "inputs/room.sog" }],
      version: 1,
    }),
  );
  return { configPath, outputDir: join(root, "output") };
}

describe("buildDataset", () => {
  it("dry-runs without invoking converters or writing output", async () => {
    const input = await fixture();
    const output = createIo();
    const runRadQualityCuts = vi.fn(async () => 0);
    const exitCode = await buildDataset(
      { ...input, dryRun: true, force: false },
      output.io,
      { runRadQualityCuts },
    );

    expect(exitCode).toBe(0);
    expect(runRadQualityCuts).not.toHaveBeenCalled();
    expect(output.stdout.join("\n")).toContain("2 dynamic RAD frame(s)");
  });

  it("orchestrates converters and emits a canonical validated manifest", async () => {
    const input = await fixture();
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: false },
      output.io,
      {
        convertQualityCutsToSog: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(
            join(request.outputDir, "quality-cuts.json"),
            JSON.stringify({
              format: "flat-sog-quality-cuts",
              frames: [1, 2].map((index) => ({
                qualityLevels: [
                  {
                    byteSize: 100 + index,
                    codec: "sog-v2",
                    detailLevel: 0.25,
                    level: 0,
                    minimumPlayable: true,
                    splatCount: 25_000,
                    url: `frame000${index}-minimum.sog`,
                  },
                ],
                sourceFile: `frame000${index}-lod.rad`,
              })),
              version: 1,
            }),
          );
          return 0;
        },
        exportStreamedSog: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(join(request.outputDir, "lod-meta.json"), "{}\n");
          return 0;
        },
        runRadQualityCuts: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(join(request.outputDir, "quality-cuts.json"), "{}\n");
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    const manifest = JSON.parse(
      await readFile(join(input.outputDir, "manifest.json"), "utf8"),
    ) as {
      audio: { url: string };
      dynamicSequences: Array<{
        frames: Array<{ qualityLevels: Array<{ byteSize: number }>; url: string }>;
      }>;
      staticObjects: Array<{ url: string }>;
    };
    expect(manifest.audio.url).toBe("audio/track.ogg");
    expect(manifest.dynamicSequences[0]?.frames[0]).toMatchObject({
      qualityLevels: [{ byteSize: 101 }],
      url: "dynamic/frame0001-minimum.sog",
    });
    expect(manifest.staticObjects[0]?.url).toBe("static/room/lod-meta.json");
  });

  it("removes partial staging output when a conversion fails", async () => {
    const input = await fixture();
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: false },
      output.io,
      {
        runRadQualityCuts: async () => 1,
      },
    );
    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain("RAD quality-cut extraction failed");
  });
});
