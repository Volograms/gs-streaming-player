import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseExplainerAssetsConfig } from "../src/explainer/explainerConfig.js";
import {
  createInitialGaussians,
  meanNeighbourDistances,
} from "../src/explainer/initialGaussians.js";
import {
  parsePlyHeader,
  readPlyHeader,
  readPointCloud,
  writeFloatPly,
} from "../src/explainer/plyFiles.js";
import {
  createStageFrame,
  isInsideBox,
  multiplyVector,
  quaternionFromMatrix,
  splatTransformStageArgs,
  toStagePoint,
} from "../src/explainer/stageFrame.js";
import { selectStageCameras } from "../src/explainer/trainingCameras.js";

import type { Mat3, Vec3 } from "../src/explainer/stageFrame.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

const TRUCK_STAGE = {
  forward: [-0.886204, 0.463296, 0] as Vec3,
  origin: [0.4, 0.2, -1.2434] as Vec3,
  up: [-0.005, -0.078, 1] as Vec3,
};

/** Replays SplatTransform's observed semantics: actions act on F * file, F = diag(-1,-1,1). */
function applySplatTransformActions(
  args: readonly string[],
  point: Vec3,
): Vec3 | undefined {
  let p: Vec3 = [-point[0], -point[1], point[2]];
  for (const arg of args) {
    const [name, list] = arg.replace(/^--/, "").split("=");
    const values = list!.split(",").map(Number);
    if (name === "translate") {
      p = [p[0] + values[0]!, p[1] + values[1]!, p[2] + values[2]!];
    } else if (name === "rotate") {
      const [x, y, z] = values.map((degrees) => (degrees * Math.PI) / 180) as [
        number,
        number,
        number,
      ];
      p = multiplyVector(
        axisRotation(0, x),
        multiplyVector(axisRotation(1, y), multiplyVector(axisRotation(2, z), p)),
      );
    } else if (name === "filter-box") {
      const inside = p.every(
        (value, axis) => value >= values[axis]! && value <= values[axis + 3]!,
      );
      if (!inside) return undefined;
    }
  }
  return [-p[0], -p[1], p[2]];
}

function axisRotation(axis: number, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 0)
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
  if (axis === 1)
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c],
    ];
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

describe("stage frame", () => {
  it("maps the origin to zero, up to +Y and forward to +X", () => {
    const frame = createStageFrame(TRUCK_STAGE);
    expect(
      toStagePoint(frame, TRUCK_STAGE.origin).every((v) => Math.abs(v) < 1e-9),
    ).toBe(true);
    const up = multiplyVector(frame.rotation, [-0.005, -0.078, 1]);
    expect(up[1]).toBeCloseTo(Math.hypot(-0.005, -0.078, 1), 9);
    const forward = multiplyVector(frame.rotation, [-0.886204, 0.463296, 0]);
    expect(forward[0]).toBeGreaterThan(0.99);
    expect(Math.abs(forward[2])).toBeLessThan(1e-9);
  });

  it("emits SplatTransform actions whose file output equals the stage frame", () => {
    const frame = createStageFrame(TRUCK_STAGE);
    const box = { max: [2.95, 1.85, 1.25] as Vec3, min: [-2.6, 0.12, -0.85] as Vec3 };
    const args = splatTransformStageArgs(frame, box);
    let kept = 0;
    for (let index = 0; index < 500; index += 1) {
      const source: Vec3 = [
        0.4 + Math.sin(index * 1.3) * 3,
        0.2 + Math.cos(index * 0.7) * 2,
        -1.2 + (Math.sin(index * 0.3) + 1) * 1.2,
      ];
      const expected = toStagePoint(frame, source);
      const actual = applySplatTransformActions(args, source);
      expect(actual === undefined).toBe(!isInsideBox(box, expected));
      if (actual === undefined) continue;
      kept += 1;
      actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis]!, 4));
    }
    expect(kept).toBeGreaterThan(50);
  });

  it("round-trips rotation matrices through quaternions", () => {
    const frame = createStageFrame(TRUCK_STAGE);
    const [w, x, y, z] = quaternionFromMatrix(frame.rotation);
    expect(Math.hypot(w, x, y, z)).toBeCloseTo(1, 9);
    expect(1 - 2 * (y * y + z * z)).toBeCloseTo(frame.rotation[0][0], 9);
    expect(2 * (y * z - w * x)).toBeCloseTo(frame.rotation[1][2], 9);
  });
});

describe("initial gaussians", () => {
  it("matches brute-force nearest-neighbour distances", () => {
    const count = 400;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] =
        ((Math.sin(index * 12.9898) * 43758.5453) % 1) * (index % 3 === 0 ? 20 : 2);
    }
    positions.set(positions.subarray(0, 3), 3); // a duplicate point
    const distances = meanNeighbourDistances(positions, 3);
    for (let i = 0; i < count; i += 1) {
      const squared: number[] = [];
      for (let j = 0; j < count; j += 1) {
        if (j === i) continue;
        const dx = positions[i * 3]! - positions[j * 3]!;
        const dy = positions[i * 3 + 1]! - positions[j * 3 + 1]!;
        const dz = positions[i * 3 + 2]! - positions[j * 3 + 2]!;
        squared.push(dx * dx + dy * dy + dz * dz);
      }
      squared.sort((a, b) => a - b);
      const expected =
        squared.slice(0, 3).reduce((sum, value) => sum + Math.sqrt(value), 0) / 3;
      expect(distances[i]).toBeCloseTo(expected, 4);
    }
  });

  it("encodes colour, opacity 0.1, identity rotation and log scale", () => {
    const values = createInitialGaussians({
      colors: new Uint8Array([255, 128, 0, 0, 0, 0]),
      count: 2,
      positions: new Float32Array([0, 0, 0, 2, 0, 0]),
    });
    expect(values).toHaveLength(28);
    expect(0.5 + 0.28209479177387814 * values[3]!).toBeCloseTo(1, 5);
    expect(1 / (1 + Math.exp(-values[6]!))).toBeCloseTo(0.1, 6);
    expect(Math.exp(values[7]!)).toBeCloseTo(2, 5);
    expect([...values.subarray(10, 14)]).toEqual([1, 0, 0, 0]);
  });
});

describe("PLY files", () => {
  it("writes float PLYs whose header can be read back", async () => {
    const root = await mkdtemp(join(tmpdir(), "explainer-ply-"));
    temporaryDirectories.push(root);
    const path = join(root, "splat.ply");
    await writeFloatPly(path, ["x", "y", "z"], new Float32Array([1, 2, 3, 4, 5, 6]));
    const header = await readPlyHeader(path);
    expect(header).toMatchObject({ format: "binary_little_endian", vertexCount: 2 });
    expect(header.properties.map(({ name }) => name)).toEqual(["x", "y", "z"]);
    expect((await readFile(path)).byteLength).toBe(header.byteLength + 24);
  });

  it("reads ASCII sparse clouds", async () => {
    const root = await mkdtemp(join(tmpdir(), "explainer-ply-"));
    temporaryDirectories.push(root);
    const path = join(root, "sparse.ply");
    await writeFile(
      path,
      [
        "ply",
        "format ascii 1.0",
        "element vertex 2",
        ...["x", "y", "z"].map((name) => `property float ${name}`),
        ...["red", "green", "blue"].map((name) => `property uint8 ${name}`),
        "end_header",
        "1 2 3 10 20 30",
        "-1 -2 -3 40 50 60",
        "",
      ].join("\n"),
    );
    const cloud = await readPointCloud(path);
    expect(cloud.count).toBe(2);
    expect([...cloud.positions]).toEqual([1, 2, 3, -1, -2, -3]);
    expect([...cloud.colors]).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("rejects files without a PLY header", () => {
    expect(() => parsePlyHeader(Buffer.from("not a ply"), "bad.ply")).toThrow(/PLY/);
  });
});

describe("training cameras", () => {
  const frame = createStageFrame({
    forward: [1, 0, 0],
    origin: [0, 0, 0],
    up: [0, 1, 0],
  });
  const transforms = {
    fl_y: 50,
    frames: Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      return {
        file_path: `images/${index}.jpg`,
        transform_matrix: [
          [1, 0, 0, Math.sin(angle) * 3],
          [0, 1, 0, 1.5],
          [0, 0, 1, Math.cos(angle) * 3],
          [0, 0, 0, 1],
        ],
      };
    }),
    h: 100,
    w: 200,
  };

  it("keeps evenly spread cameras with shared intrinsics", () => {
    const set = selectStageCameras(transforms, frame, 4);
    expect(set).toMatchObject({ aspect: 2, height: 100, totalCount: 12, width: 200 });
    expect(set.verticalFovDegrees).toBeCloseTo(90, 5);
    expect(set.cameras).toHaveLength(4);
    expect(new Set(set.cameras.map(({ image }) => image)).size).toBe(4);
    expect(set.cameras[0]!.rotation).toEqual([1, 0, 0, 0]);
  });

  it("rejects transforms without intrinsics", () => {
    expect(() => selectStageCameras({ frames: [] }, frame, 4)).toThrow(/intrinsics/);
  });
});

describe("explainer config", () => {
  const valid = {
    cameraTransforms: "transforms.json",
    checkpoints: [
      { iteration: 0, source: "initialisation" },
      { input: "checkpoints/splat_500.ply", iteration: 500 },
    ],
    cropBox: { max: [1, 1, 1], min: [-1, 0, -1] },
    datasetDir: "../data",
    id: "truck",
    sparsePointCloud: "sparse_pc.ply",
    stage: TRUCK_STAGE,
    trainingCountDirs: ["checkpoints"],
    version: 1,
  };

  it("applies defaults", () => {
    expect(parseExplainerAssetsConfig(valid)).toMatchObject({
      cameraCount: 20,
      maxSh: 1,
    });
  });

  it.each([
    [
      {
        checkpoints: [
          { input: "a.ply", iteration: 5 },
          { input: "b.ply", iteration: 5 },
        ],
      },
      /above/,
    ],
    [{ checkpoints: [{ iteration: 3, source: "initialisation" }] }, /iteration 0/],
    [{ cropBox: { max: [1, 1, 1], min: [1, 0, 0] } }, /smaller/],
    [{ stage: { ...TRUCK_STAGE, up: [0, 1] } }, /stage.up/],
    [{ maxSh: 4 }, /maxSh/],
  ])("rejects invalid configs", (override, message) => {
    expect(() => parseExplainerAssetsConfig({ ...valid, ...override })).toThrow(
      message,
    );
  });
});
