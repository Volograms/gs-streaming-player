import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/runCli.js";
import { buildExplainerAssets } from "../src/explainer/buildExplainerAssets.js";
import { readPlyHeader, writeFloatPly } from "../src/explainer/plyFiles.js";

import type {
  BuildExplainerAssetsRequest,
  ExplainerAssetsIndex,
} from "../src/explainer/buildExplainerAssets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "explainer-assets-test-"));
  temporaryDirectories.push(root);
  const datasetDir = join(root, "dataset");
  await mkdir(join(datasetDir, "checkpoints"), { recursive: true });
  const sparse = [
    "0 0 0.5 255 0 0",
    "0.2 0 0.5 0 255 0",
    "0 0.2 0.5 0 0 255",
    "9 9 9 1 2 3",
  ];
  await writeFile(
    join(datasetDir, "sparse_pc.ply"),
    [
      "ply",
      "format ascii 1.0",
      `element vertex ${sparse.length}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      ...sparse,
      "",
    ].join("\n"),
  );
  await writeFloatPly(
    join(datasetDir, "checkpoints/splat_500.ply"),
    ["x", "y", "z"],
    new Float32Array(15),
  );
  await writeFloatPly(
    join(datasetDir, "checkpoints/splat_1000.ply"),
    ["x", "y", "z"],
    new Float32Array(21),
  );
  await writeFile(
    join(datasetDir, "transforms.json"),
    JSON.stringify({
      fl_y: 100,
      frames: [0, 1, 2].map((index) => ({
        file_path: `images/${index}.jpg`,
        transform_matrix: [
          [1, 0, 0, index],
          [0, 1, 0, 0],
          [0, 0, 1, 3],
          [0, 0, 0, 1],
        ],
      })),
      h: 100,
      w: 150,
    }),
  );
  const configPath = join(root, "explainer.json");
  await writeFile(
    configPath,
    JSON.stringify({
      cameraCount: 2,
      cameraTransforms: "transforms.json",
      checkpoints: [
        { iteration: 0, source: "initialisation" },
        { input: "checkpoints/splat_500.ply", iteration: 500 },
      ],
      cropBoxes: [
        { max: [1, 0.4, 1], min: [-1, 0, -1] },
        { max: [1, 1, 1], min: [-1, 0.4, -1] },
      ],
      datasetDir: "dataset",
      id: "fixture",
      sparsePointCloud: "sparse_pc.ply",
      stage: { forward: [1, 0, 0], origin: [0, 0, 0], up: [0, 0, 1] },
      trainingCountDirs: ["checkpoints"],
      version: 1,
    }),
  );
  const outputDir = join(root, "output");
  const request: BuildExplainerAssetsRequest = {
    configPath,
    force: false,
    maxWorkers: 2,
    outputDir,
    shIterations: 5,
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[][] = [];
  const runSplatTransform = async (args: readonly string[]) => {
    calls.push([...args]);
    const output = [...args]
      .reverse()
      .find((arg) => !arg.startsWith("--") && /\.(ply|sog)$/.test(arg));
    if (output?.endsWith(".ply")) {
      await writeFloatPly(output, ["x", "y", "z"], new Float32Array(9));
    } else if (output !== undefined) {
      await writeFile(output, "sog");
    }
  };
  return {
    calls,
    io: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    outputDir,
    request,
    runSplatTransform,
    stderr,
  };
}

describe("buildExplainerAssets", () => {
  it("crops every checkpoint into the stage frame and writes the asset index", async () => {
    const fixture = await createFixture();
    const exitCode = await buildExplainerAssets(fixture.request, fixture.io, {
      runSplatTransform: fixture.runSplatTransform,
    });
    expect(fixture.stderr).toEqual([]);
    expect(exitCode).toBe(0);

    // Per checkpoint: one crop per box, a merge of the parts, then the SOG encode.
    const [lowerBox, upperBox, merge, encode] = fixture.calls;
    expect(lowerBox![0]).toMatch(/initialisation\.ply$/);
    expect(lowerBox).toContain("--filter-harmonics=1");
    const filterBox = (args: string[]) =>
      args.find((arg) => arg.startsWith("--filter-box="));
    expect(filterBox(lowerBox!)).not.toBe(filterBox(upperBox!));
    expect(merge).toHaveLength(3);
    expect(merge![2]).toMatch(/iteration-0\.ply$/);
    expect(encode).toEqual(
      expect.arrayContaining(["--sh-iterations", "5", "--max-workers", "2"]),
    );
    expect(fixture.calls).toHaveLength(8);

    const index = JSON.parse(
      await readFile(join(fixture.outputDir, "explainer-assets.json"), "utf8"),
    ) as ExplainerAssetsIndex;
    expect(index.checkpoints).toEqual([
      {
        iteration: 0,
        source: "initialisation",
        splatCount: 3,
        trainingSplatCount: 4,
        url: "checkpoints/iteration-00000.sog",
      },
      {
        iteration: 500,
        source: "checkpoint",
        splatCount: 3,
        trainingSplatCount: 5,
        url: "checkpoints/iteration-00500.sog",
      },
    ]);
    expect(index.trainingCounts).toEqual([
      { iteration: 0, splatCount: 4 },
      { iteration: 500, splatCount: 5 },
      { iteration: 1000, splatCount: 7 },
    ]);
    // Z-up source: the three nearby points sit 0.5 above the ground; the far one is cropped.
    expect(index.sparsePoints).toMatchObject({ colorsByteOffset: 36, count: 3 });
    const points = await readFile(join(fixture.outputDir, "sparse-points.bin"));
    expect(points.byteLength).toBe(3 * 12 + 3 * 3);
    expect(new Float32Array(points.buffer, points.byteOffset, 3)[1]).toBeCloseTo(
      0.5,
      6,
    );
    expect(index.cameras.cameras).toHaveLength(2);
  });

  it("generates the initialisation from the sparse cloud", async () => {
    const fixture = await createFixture();
    let initialisationCount = 0;
    await buildExplainerAssets(fixture.request, fixture.io, {
      runSplatTransform: async (args) => {
        if (args[0]?.endsWith("initialisation.ply")) {
          initialisationCount = (await readPlyHeader(args[0])).vertexCount;
        }
        await fixture.runSplatTransform(args);
      },
    });
    expect(initialisationCount).toBe(4);
  });

  it("refuses to replace existing output without --force", async () => {
    const fixture = await createFixture();
    const dependencies = { runSplatTransform: fixture.runSplatTransform };
    expect(await buildExplainerAssets(fixture.request, fixture.io, dependencies)).toBe(
      0,
    );
    expect(await buildExplainerAssets(fixture.request, fixture.io, dependencies)).toBe(
      1,
    );
    expect(fixture.stderr.at(-1)).toMatch(/already exists/);

    await writeFile(join(fixture.outputDir, "unrelated.txt"), "keep");
    const forced = { ...fixture.request, force: true };
    expect(await buildExplainerAssets(forced, fixture.io, dependencies)).toBe(0);
    await expect(stat(join(fixture.outputDir, "unrelated.txt"))).resolves.toBeDefined();
  });

  it("is reachable from the CLI", async () => {
    const received: BuildExplainerAssetsRequest[] = [];
    const exitCode = await runCli(
      [
        "build-explainer",
        "config.json",
        "--output-dir",
        "out",
        "--max-workers",
        "0",
        "--force",
      ],
      { stderr: () => undefined, stdout: () => undefined },
      {
        buildExplainerAssets: async (request) => {
          received.push(request);
          return 0;
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(received).toEqual([
      {
        configPath: "config.json",
        force: true,
        maxWorkers: 0,
        outputDir: "out",
        shIterations: 10,
      },
    ]);
    const errors: string[] = [];
    expect(
      await runCli(["build-explainer", "config.json"], {
        stderr: (m) => errors.push(m),
        stdout: () => undefined,
      }),
    ).toBe(2);
    expect(errors[0]).toMatch(/--output-dir/);
  });
});
