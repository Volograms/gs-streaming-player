import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { runSplatTransformCli } from "../sog/runSplatTransformCli.js";

import { encodePng } from "./encodePng.js";
import { parseExplainerAssetsConfig } from "./explainerConfig.js";
import {
  createInitialGaussians,
  initialScales,
  INITIAL_GAUSSIAN_PROPERTIES,
} from "./initialGaussians.js";
import {
  readPlyHeader,
  readPlyVertices,
  readPointCloud,
  writeFloatPly,
} from "./plyFiles.js";
import { gaussiansFromPly, renderGaussians } from "./renderGaussians.js";
import { ELLIPSOID_STRIDE, selectEllipsoids } from "./selectEllipsoids.js";
import {
  createStageFrame,
  isInsideBox,
  splatTransformStageArgs,
  toStagePoint,
} from "./stageFrame.js";
import { selectStageCameras } from "./trainingCameras.js";

import type {
  ExplainerAssetsConfig,
  ExplainerCheckpointConfig,
} from "./explainerConfig.js";
import type { ProjectionViewConfig } from "./explainerConfig.js";
import type { PointCloud } from "./plyFiles.js";
import type { StageBox, StageFrame, Vec3 } from "./stageFrame.js";
import type { StageCameraSet } from "./trainingCameras.js";
import type { SplatTransformCliRunner } from "../sog/runSplatTransformCli.js";

export interface BuildExplainerAssetsRequest {
  configPath: string;
  force: boolean;
  maxWorkers: number;
  outputDir: string;
  shIterations: number;
}

export interface BuildExplainerAssetsIo {
  stderr(message: string): void;
  stdout(message: string): void;
}

export interface BuildExplainerAssetsDependencies {
  runSplatTransform?: SplatTransformCliRunner;
}

export type BuildExplainerAssetsRunner = (
  request: BuildExplainerAssetsRequest,
  io: BuildExplainerAssetsIo,
) => Promise<number>;

export const EXPLAINER_ASSETS_FILENAME = "explainer-assets.json";
const CHECKPOINT_DIR = "checkpoints";
const SPARSE_POINTS_FILENAME = "sparse-points.bin";
const PROJECTION_FILENAME = "projection.png";
const ELLIPSOIDS_FILENAME = "ellipsoids.bin";
const CHECKPOINT_FILENAME = /^splat_(\d+)\.ply$/;

export interface ExplainerAssetsIndex {
  cameras: StageCameraSet;
  checkpoints: {
    iteration: number;
    source: ExplainerCheckpointConfig["source"];
    splatCount: number;
    trainingSplatCount: number;
    url: string;
  }[];
  cropBoxes: StageBox[];
  id: string;
  /** Opaque gaussians of one checkpoint for the ellipsoid view, when configured. */
  ellipsoids?: {
    count: number;
    iteration: number;
    layout: "float32 per ellipsoid: position xyz, rotation wxyz, sigma xyz, colour rgb";
    url: string;
  };
  /** Render of one checkpoint from a virtual stage-frame camera, when configured. */
  projectionView?: ProjectionViewConfig & { url: string };
  sourceToStage: StageFrame;
  sparsePoints: {
    colorsByteOffset: number;
    count: number;
    layout: "float32 xyz positions, float32 initial scales, uint8 rgb colours";
    positionsByteOffset: 0;
    /** Initial gaussian sigma per point, in stage metres (the iteration 0 size). */
    scalesByteOffset: number;
    url: string;
  };
  trainingCounts: { iteration: number; splatCount: number }[];
  version: 1;
}

/**
 * Prepares the demo object for the 6G showcase explainer: every configured training
 * checkpoint is moved into the Y-up stage frame, cropped and encoded as SOG, alongside
 * the sparse cloud, a subset of training cameras and the real per-iteration counts.
 */
export async function buildExplainerAssets(
  request: BuildExplainerAssetsRequest,
  io: BuildExplainerAssetsIo,
  dependencies: BuildExplainerAssetsDependencies = {},
): Promise<number> {
  let temporaryDir: string | undefined;
  try {
    const configPath = resolve(request.configPath);
    const config = parseExplainerAssetsConfig(
      JSON.parse(await readFile(configPath, "utf8")) as unknown,
    );
    const datasetDir = resolveFrom(dirname(configPath), config.datasetDir);
    const outputDir = resolve(request.outputDir);
    const indexPath = join(outputDir, EXPLAINER_ASSETS_FILENAME);
    await prepareOutput(outputDir, indexPath, request.force);

    const runSplatTransform = dependencies.runSplatTransform ?? runSplatTransformCli;
    const frame = createStageFrame(config.stage);
    const boxArgs = config.cropBoxes.map((box) => splatTransformStageArgs(frame, box));
    const cloud = await readPointCloud(join(datasetDir, config.sparsePointCloud));
    const scales = initialScales(cloud);
    const trainingCounts = await collectTrainingCounts(datasetDir, config, cloud.count);
    temporaryDir = await mkdtemp(join(tmpdir(), "gs-explainer-"));

    const checkpoints: ExplainerAssetsIndex["checkpoints"] = [];
    let renderedProjection = false;
    let ellipsoidCount: number | undefined;
    for (const checkpoint of config.checkpoints) {
      let inputPath: string;
      if (checkpoint.source === "initialisation") {
        io.stdout("Generating iteration 0 gaussians from the sparse cloud.");
        inputPath = join(temporaryDir, "initialisation.ply");
        await writeFloatPly(
          inputPath,
          INITIAL_GAUSSIAN_PROPERTIES,
          createInitialGaussians(cloud, scales),
        );
      } else {
        inputPath = join(datasetDir, checkpoint.input!);
        await access(inputPath);
      }
      const croppedPath = join(temporaryDir, `iteration-${checkpoint.iteration}.ply`);
      const url = `${CHECKPOINT_DIR}/iteration-${String(checkpoint.iteration).padStart(5, "0")}.sog`;
      io.stdout(`Cropping iteration ${checkpoint.iteration} into the stage frame.`);
      const parts = boxArgs.map((_, index) =>
        boxArgs.length === 1
          ? croppedPath
          : join(temporaryDir!, `iteration-${checkpoint.iteration}-box-${index}.ply`),
      );
      for (const [index, args] of boxArgs.entries()) {
        await runSplatTransform([
          inputPath,
          ...args,
          `--filter-harmonics=${config.maxSh}`,
          parts[index]!,
        ]);
      }
      if (parts.length > 1) {
        // Multiple inputs are concatenated into one working set by SplatTransform.
        await runSplatTransform([...parts, croppedPath]);
      }
      const splatCount = (await readPlyHeader(croppedPath)).vertexCount;
      if (config.ellipsoidView?.iteration === checkpoint.iteration) {
        const values = selectEllipsoids(
          gaussiansFromPly(await readPlyVertices(croppedPath)),
          config.ellipsoidView.count,
        );
        await writeFile(
          join(outputDir, ELLIPSOIDS_FILENAME),
          Buffer.from(values.buffer),
        );
        ellipsoidCount = values.length / ELLIPSOID_STRIDE;
      }
      if (config.projectionView?.iteration === checkpoint.iteration) {
        io.stdout(
          `Rendering iteration ${checkpoint.iteration} for the projection view.`,
        );
        const view = config.projectionView;
        const pixels = renderGaussians(
          gaussiansFromPly(await readPlyVertices(croppedPath)),
          view,
        );
        await writeFile(
          join(outputDir, PROJECTION_FILENAME),
          encodePng(pixels, view.width, view.height),
        );
        renderedProjection = true;
      }
      await runSplatTransform([
        croppedPath,
        join(outputDir, url),
        "--sh-iterations",
        String(request.shIterations),
        "--max-workers",
        String(request.maxWorkers),
        "--overwrite",
      ]);
      const trainingSplatCount =
        trainingCounts.find(({ iteration }) => iteration === checkpoint.iteration)
          ?.splatCount ?? (await readPlyHeader(inputPath)).vertexCount;
      checkpoints.push({
        iteration: checkpoint.iteration,
        source: checkpoint.source,
        splatCount,
        trainingSplatCount,
        url,
      });
    }

    if (config.ellipsoidView !== undefined && ellipsoidCount === undefined) {
      throw new Error(
        `ellipsoidView.iteration ${config.ellipsoidView.iteration} is not a configured checkpoint.`,
      );
    }
    if (config.projectionView !== undefined && !renderedProjection) {
      throw new Error(
        `projectionView.iteration ${config.projectionView.iteration} is not a configured checkpoint.`,
      );
    }
    const sparsePoints = await writeSparsePoints(
      join(outputDir, SPARSE_POINTS_FILENAME),
      cloud,
      scales,
      frame,
      config.cropBoxes,
    );
    const cameras = selectStageCameras(
      JSON.parse(
        await readFile(join(datasetDir, config.cameraTransforms), "utf8"),
      ) as unknown,
      frame,
      config.cameraCount,
    );
    const index: ExplainerAssetsIndex = {
      cameras,
      checkpoints,
      cropBoxes: config.cropBoxes,
      id: config.id,
      sourceToStage: frame,
      sparsePoints: {
        colorsByteOffset: sparsePoints * 16,
        count: sparsePoints,
        layout: "float32 xyz positions, float32 initial scales, uint8 rgb colours",
        positionsByteOffset: 0,
        scalesByteOffset: sparsePoints * 12,
        url: SPARSE_POINTS_FILENAME,
      },
      trainingCounts,
      version: 1,
      ...(config.ellipsoidView === undefined || ellipsoidCount === undefined
        ? {}
        : {
            ellipsoids: {
              count: ellipsoidCount,
              iteration: config.ellipsoidView.iteration,
              layout:
                "float32 per ellipsoid: position xyz, rotation wxyz, sigma xyz, colour rgb",
              url: ELLIPSOIDS_FILENAME,
            },
          }),
      ...(config.projectionView === undefined
        ? {}
        : { projectionView: { ...config.projectionView, url: PROJECTION_FILENAME } }),
    };
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    io.stdout(
      `Wrote ${checkpoints.length} checkpoints, ${sparsePoints} sparse points and ` +
        `${cameras.cameras.length}/${cameras.totalCount} cameras to ${indexPath}`,
    );
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (temporaryDir !== undefined) {
      await rm(temporaryDir, { force: true, recursive: true });
    }
  }
}

async function prepareOutput(outputDir: string, indexPath: string, force: boolean) {
  if (await exists(indexPath)) {
    if (!force) throw new Error(`Output already exists: ${indexPath}`);
    await Promise.all(
      [
        EXPLAINER_ASSETS_FILENAME,
        CHECKPOINT_DIR,
        SPARSE_POINTS_FILENAME,
        PROJECTION_FILENAME,
        ELLIPSOIDS_FILENAME,
      ].map((entry) => rm(join(outputDir, entry), { force: true, recursive: true })),
    );
  }
  await mkdir(join(outputDir, CHECKPOINT_DIR), { recursive: true });
}

async function collectTrainingCounts(
  datasetDir: string,
  config: ExplainerAssetsConfig,
  initialCount: number,
): Promise<ExplainerAssetsIndex["trainingCounts"]> {
  const counts = new Map<number, number>([[0, initialCount]]);
  for (const dir of config.trainingCountDirs) {
    const path = join(datasetDir, dir);
    for (const name of (await readdir(path)).sort()) {
      const match = CHECKPOINT_FILENAME.exec(name);
      if (match === null) continue;
      counts.set(Number(match[1]), (await readPlyHeader(join(path, name))).vertexCount);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([iteration, splatCount]) => ({ iteration, splatCount }));
}

async function writeSparsePoints(
  path: string,
  cloud: PointCloud,
  scales: Float32Array,
  frame: StageFrame,
  boxes: readonly StageBox[],
): Promise<number> {
  const positions: number[] = [];
  const kept: number[] = [];
  const colors: number[] = [];
  for (let point = 0; point < cloud.count; point += 1) {
    const source = cloud.positions.subarray(point * 3, point * 3 + 3);
    const stage = toStagePoint(frame, [source[0]!, source[1]!, source[2]!] as Vec3);
    if (!boxes.some((box) => isInsideBox(box, stage))) continue;
    positions.push(...stage);
    kept.push(scales[point]!);
    colors.push(...cloud.colors.subarray(point * 3, point * 3 + 3));
  }
  const bytes = Buffer.concat([
    Buffer.from(new Float32Array(positions).buffer),
    Buffer.from(new Float32Array(kept).buffer),
    Buffer.from(new Uint8Array(colors)),
  ]);
  await writeFile(path, bytes);
  return positions.length / 3;
}

function resolveFrom(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
