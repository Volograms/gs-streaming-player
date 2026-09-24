import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { assertValidManifest } from "@6g-path/gaussian-player";
import { describe, expect, it, vi } from "vitest";

import { buildDataset } from "../src/build-dataset/buildDataset.js";

import type { BuildDatasetDependencies } from "../src/build-dataset/buildDataset.js";

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

async function fixture(outputFormat: "sog" | "spz" = "sog", regularTiming?: boolean) {
  const root = await mkdtemp(join(tmpdir(), "gs-content-build-"));
  const inputDir = join(root, "inputs");
  await mkdir(inputDir);
  await writeFile(join(inputDir, "frame0001.ply"), "ply-one");
  await writeFile(join(inputDir, "frame0002.spz"), "spz-two");
  await writeFile(join(inputDir, "room.sog"), "static");
  await writeFile(join(inputDir, "track.ogg"), "audio");
  const configPath = join(root, "dataset.json");
  await writeFile(
    configPath,
    JSON.stringify({
      audio: { contentType: "audio/ogg", input: "inputs/track.ogg" },
      dynamic: {
        ...(regularTiming === undefined ? {} : { regularTiming }),
        frameWorkers: 2,
        frames: ["inputs/frame0001.ply", "inputs/frame0002.spz"],
        id: "actor",
        minimumPlayable: "minimum",
        outputFormat,
        tiers: { minimum: 0.25, full: 1 },
        transform: {
          position: { x: 1, y: 0.25, z: -2 },
          rotationDegrees: { x: 180, y: 0, z: 0 },
          scale: 0.75,
        },
      },
      frameRate: 30,
      id: "public-sample",
      staticObjects: [
        {
          id: "room",
          input: "inputs/room.sog",
          transform: {
            position: { x: 0, y: -1, z: 0 },
            rotationDegrees: { x: 180, y: 0, z: 0 },
            scale: 4,
          },
        },
      ],
      version: 1,
    }),
  );
  return { configPath, outputDir: join(root, "output"), root };
}

function successfulDependencies(): BuildDatasetDependencies {
  return {
    exportStreamedSog: async (request) => {
      await mkdir(request.outputDir, { recursive: true });
      await writeFile(join(request.outputDir, "lod-meta.json"), "{}\n");
      return 0;
    },
    generateDynamicTiers: async (request) => {
      await mkdir(request.outputDir, { recursive: true });
      const extension = request.outputFormat;
      const qualityLevels = request.inputPaths.map((_, frameIndex) => ({
        byteSize: 100 + frameIndex,
        codec: request.outputFormat === "sog" ? "sog-v2" : "spz-v4",
        detailLevel: 0.25,
        level: 0,
        minimumPlayable: true,
        splatCount: 25_000,
        url: `frame-${frameIndex}-minimum.${extension}`,
      }));
      await Promise.all(
        qualityLevels.map(({ url }) =>
          writeFile(join(request.outputDir, url), `generated ${url}\n`),
        ),
      );
      await writeFile(
        join(request.outputDir, "quality-cuts.json"),
        JSON.stringify({
          format:
            request.outputFormat === "sog"
              ? "flat-sog-quality-cuts"
              : "flat-spz-quality-cuts",
          frames: request.inputPaths.map((sourceFile, frameIndex) => ({
            qualityLevels: [qualityLevels[frameIndex]!],
            sourceFile,
          })),
          version: 1,
        }),
      );
      return 0;
    },
  };
}

describe("buildDataset", () => {
  it("discovers top-level PLY/SPZ frames from inputDir in natural filename order", async () => {
    const root = await mkdtemp(join(tmpdir(), "gs-content-input-dir-"));
    const sequenceDir = join(root, "frames");
    await mkdir(sequenceDir);
    await writeFile(join(sequenceDir, "frame10.ply"), "ten");
    await writeFile(join(sequenceDir, "frame2.spz"), "two");
    await writeFile(join(sequenceDir, "frame1.ply"), "one");
    await writeFile(join(sequenceDir, "notes.txt"), "ignored");
    await mkdir(join(sequenceDir, "nested"));
    await writeFile(join(sequenceDir, "nested", "frame0.ply"), "ignored");
    const configPath = join(root, "dataset.json");
    await writeFile(
      configPath,
      JSON.stringify({
        dynamic: {
          id: "actor",
          inputDir: "frames",
          minimumPlayable: "minimum",
          tiers: { minimum: 0.25, full: 1 },
        },
        frameRate: 30,
        id: "folder-sequence",
        version: 1,
      }),
    );
    const output = createIo();
    const inputPaths: string[][] = [];
    const exitCode = await buildDataset(
      {
        configPath,
        dryRun: false,
        force: false,
        outputDir: join(root, "output"),
      },
      output.io,
      {
        generateDynamicTiers: async (request) => {
          inputPaths.push(request.inputPaths);
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(
            join(request.outputDir, "quality-cuts.json"),
            JSON.stringify({
              format: "flat-sog-quality-cuts",
              frames: request.inputPaths.map((path, index) => ({
                qualityLevels: [
                  {
                    byteSize: 100,
                    codec: "sog-v2",
                    detailLevel: 0.25,
                    level: 0,
                    minimumPlayable: true,
                    splatCount: 25,
                    url: `frame${index}-minimum.sog`,
                  },
                ],
                sourceFile: path,
              })),
              version: 1,
            }),
          );
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(inputPaths).toEqual([
      [
        join(sequenceDir, "frame1.ply"),
        join(sequenceDir, "frame2.spz"),
        join(sequenceDir, "frame10.ply"),
      ],
    ]);
  });

  it("dry-runs without invoking converters or writing output", async () => {
    const input = await fixture();
    const output = createIo();
    const generateDynamicTiers = vi.fn(async () => 0);
    const exitCode = await buildDataset(
      { ...input, dryRun: true, force: false },
      output.io,
      { generateDynamicTiers },
    );

    expect(exitCode).toBe(0);
    expect(generateDynamicTiers).not.toHaveBeenCalled();
    expect(output.stdout.join("\n")).toContain(
      "2 dynamic PLY/SPZ frame(s) -> SOG tiers",
    );
    await expect(access(input.outputDir)).rejects.toThrow();
  });

  it("force replaces only generated entries and preserves unrelated output", async () => {
    const input = await fixture();
    const dependencies = successfulDependencies();
    const firstOutput = createIo();
    expect(
      await buildDataset(
        { ...input, dryRun: false, force: false },
        firstOutput.io,
        dependencies,
      ),
    ).toBe(0);

    const sentinelPath = join(input.outputDir, "keep-me.txt");
    const staleDynamicPath = join(input.outputDir, "dynamic", "stale.sog");
    await writeFile(sentinelPath, "unrelated\n");
    await writeFile(staleDynamicPath, "stale\n");
    const configuration = JSON.parse(await readFile(input.configPath, "utf8")) as {
      audio?: unknown;
      staticObjects?: unknown[];
    };
    delete configuration.audio;
    configuration.staticObjects = [];
    await writeFile(input.configPath, JSON.stringify(configuration));

    const secondOutput = createIo();
    expect(
      await buildDataset(
        { ...input, dryRun: false, force: true },
        secondOutput.io,
        dependencies,
      ),
    ).toBe(0);

    expect(await readFile(sentinelPath, "utf8")).toBe("unrelated\n");
    await expect(access(staleDynamicPath)).rejects.toThrow();
    await expect(access(join(input.outputDir, "audio"))).rejects.toThrow();
    await expect(access(join(input.outputDir, "static"))).rejects.toThrow();
    await expect(
      access(join(input.outputDir, "manifest.json")),
    ).resolves.toBeUndefined();
  });

  it("refuses to force-replace generated-looking paths without a valid manifest", async () => {
    const input = await fixture();
    const generatedPath = join(input.outputDir, "dynamic", "unrelated.sog");
    await mkdir(dirname(generatedPath), { recursive: true });
    await writeFile(generatedPath, "unrelated\n");
    const output = createIo();
    const generateDynamicTiers = vi.fn(async () => 0);

    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: true },
      output.io,
      { generateDynamicTiers },
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "Refusing to replace generated-looking entries without an existing manifest.json",
    );
    expect(generateDynamicTiers).not.toHaveBeenCalled();
    expect(await readFile(generatedPath, "utf8")).toBe("unrelated\n");
  });

  it("rejects path-like static object ids before invoking converters", async () => {
    const input = await fixture();
    const configuration = JSON.parse(await readFile(input.configPath, "utf8")) as {
      staticObjects: Array<{ id: string }>;
    };
    configuration.staticObjects[0]!.id = "../../scene";
    await writeFile(input.configPath, JSON.stringify(configuration));
    const output = createIo();
    const exportStreamedSog = vi.fn(async () => 0);
    const generateDynamicTiers = vi.fn(async () => 0);

    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: false },
      output.io,
      { exportStreamedSog, generateDynamicTiers },
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain("path-safe id");
    expect(generateDynamicTiers).not.toHaveBeenCalled();
    expect(exportStreamedSog).not.toHaveBeenCalled();
    await expect(access(join(input.root, "scene"))).rejects.toThrow();
  });

  it("generates tiers directly and emits a canonical validated SOG manifest", async () => {
    const input = await fixture();
    const output = createIo();
    const requests: unknown[] = [];
    const exitCode = await buildDataset(
      {
        ...input,
        dryRun: false,
        force: false,
        frameWorkers: 8,
        maxWorkers: 2,
      },
      output.io,
      {
        exportStreamedSog: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(join(request.outputDir, "lod-meta.json"), "{}\n");
          return 0;
        },
        generateDynamicTiers: async (request) => {
          requests.push(request);
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(
            join(request.outputDir, "quality-cuts.json"),
            JSON.stringify({
              format: "flat-sog-quality-cuts",
              frames: [
                ["frame0001.ply", "frame0001-minimum.sog"],
                ["frame0002.spz", "frame0002-minimum.sog"],
              ].map(([sourceFile, url], index) => ({
                qualityLevels: [
                  {
                    byteSize: 101 + index,
                    codec: "sog-v2",
                    detailLevel: 0.25,
                    level: 0,
                    minimumPlayable: true,
                    splatCount: 25_000,
                    url,
                  },
                ],
                sourceFile,
              })),
              version: 1,
            }),
          );
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(requests).toEqual([
      expect.objectContaining({
        frameWorkers: 8,
        inputPaths: [
          join(input.root, "inputs", "frame0001.ply"),
          join(input.root, "inputs", "frame0002.spz"),
        ],
        minimumPlayable: "minimum",
        maxWorkers: 2,
        outputFormat: "sog",
        tiers: { minimum: 0.25, full: 1 },
      }),
    ]);
    const json = await readFile(join(input.outputDir, "manifest.json"), "utf8");
    const document: unknown = JSON.parse(json);
    expect(json.trim().split("\n")).toHaveLength(1);
    expect(document).toMatchObject({
      version: "1.1",
      dynamicSequences: [{ regularTiming: true, codec: "sog-v2" }],
    });
    const manifest = assertValidManifest(document);
    expect(manifest.audio?.url).toBe("audio/track.ogg");
    expect(manifest.dynamicSequences[0]?.frames[0]).toMatchObject({
      codec: "sog-v2",
      qualityLevels: [{ byteSize: 101 }],
      url: "dynamic/frame0001-minimum.sog",
    });
    expect(manifest.dynamicSequences[0]?.transform).toMatchObject({
      position: { x: 1, y: 0.25, z: -2 },
      scale: { x: 0.75, y: 0.75, z: 0.75 },
    });
    expect(manifest.dynamicSequences[0]?.transform?.rotation?.x).toBeCloseTo(1);
    expect(manifest.dynamicSequences[0]?.transform?.rotation?.w).toBeCloseTo(0);
    expect(manifest.staticObjects[0]?.url).toBe("static/room/lod-meta.json");
    expect(manifest.staticObjects[0]?.transform).toMatchObject({
      position: { x: 0, y: -1, z: 0 },
      scale: { x: 4, y: 4, z: 4 },
    });
    expect(manifest.staticObjects[0]?.transform?.rotation?.x).toBeCloseTo(1);
  });

  it("emits an SPZ v4 manifest when dynamic.outputFormat is spz", async () => {
    const input = await fixture("spz", false);
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: false },
      output.io,
      {
        exportStreamedSog: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(join(request.outputDir, "lod-meta.json"), "{}\n");
          return 0;
        },
        generateDynamicTiers: async (request) => {
          await mkdir(request.outputDir, { recursive: true });
          await writeFile(
            join(request.outputDir, "quality-cuts.json"),
            JSON.stringify({
              format: "flat-spz-quality-cuts",
              frames: request.inputPaths.map((path, index) => ({
                qualityLevels: [
                  {
                    codec: "spz-v4",
                    detailLevel: 0.25,
                    level: 0,
                    minimumPlayable: true,
                    url: `frame000${index + 1}-minimum.spz`,
                  },
                ],
                sourceFile: path,
              })),
              version: 1,
            }),
          );
          return 0;
        },
      },
    );

    expect(exitCode).toBe(0);
    const document: unknown = JSON.parse(
      await readFile(join(input.outputDir, "manifest.json"), "utf8"),
    );
    expect(document).toMatchObject({
      dynamicSequences: [
        {
          regularTiming: false,
          frames: [{ timestampSeconds: 0 }, { timestampSeconds: 1 / 30 }],
        },
      ],
    });
    const manifest = assertValidManifest(document);
    expect(manifest.dynamicSequences[0]?.frames[0]?.codec).toBe("spz-v4");
  });

  it("removes partial staging output when tier generation fails", async () => {
    const input = await fixture();
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: false, force: false },
      output.io,
      {
        generateDynamicTiers: async () => 1,
      },
    );
    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "dynamic quality-tier generation failed",
    );
    await expect(access(input.outputDir)).rejects.toThrow();
  });

  it("rejects RAD frames from the normal build contract", async () => {
    const input = await fixture();
    await writeFile(
      input.configPath,
      JSON.stringify({
        dynamic: { frames: ["inputs/frame.rad"], id: "actor" },
        frameRate: 30,
        id: "legacy",
        version: 1,
      }),
    );
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: true, force: false },
      output.io,
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain("must be a PLY or SPZ");
  });

  it("rejects ambiguous dynamic input with both frames and inputDir", async () => {
    const input = await fixture();
    await writeFile(
      input.configPath,
      JSON.stringify({
        dynamic: {
          frames: ["inputs/frame0001.ply"],
          id: "actor",
          inputDir: "inputs",
        },
        frameRate: 30,
        id: "ambiguous",
        version: 1,
      }),
    );
    const output = createIo();
    const exitCode = await buildDataset(
      { ...input, dryRun: true, force: false },
      output.io,
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "requires exactly one of frames or inputDir",
    );
  });

  it("rejects ambiguous degree and quaternion rotations before conversion", async () => {
    const input = await fixture();
    const configuration = JSON.parse(await readFile(input.configPath, "utf8")) as {
      dynamic: { transform: Record<string, unknown> };
    };
    configuration.dynamic.transform.rotation = { w: 1, x: 0, y: 0, z: 0 };
    await writeFile(input.configPath, JSON.stringify(configuration));
    const output = createIo();
    const generateDynamicTiers = vi.fn(async () => 0);

    const exitCode = await buildDataset(
      { ...input, dryRun: true, force: false },
      output.io,
      { generateDynamicTiers },
    );

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "cannot define both rotation and rotationDegrees",
    );
    expect(generateDynamicTiers).not.toHaveBeenCalled();
  });
});
