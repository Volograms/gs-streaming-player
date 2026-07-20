import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface QualityCutLevel {
  byteSize?: number;
  codec?: string;
  url?: string;
  [key: string]: unknown;
}

interface QualityCutFrame {
  qualityLevels: QualityCutLevel[];
  [key: string]: unknown;
}

interface QualityCutIndex {
  format: "flat-spz-quality-cuts";
  frames: QualityCutFrame[];
  version: 1;
  [key: string]: unknown;
}

export interface RepackSpzV4Request {
  force: boolean;
  indexPath: string;
  outputDir: string;
  spzToolsDir: string;
}

export interface RepackSpzV4Io {
  stderr(message: string): void;
  stdout(message: string): void;
}

export type RepackSpzV4Runner = (
  request: RepackSpzV4Request,
  io: RepackSpzV4Io,
) => Promise<number>;

/** Re-encodes every flat tier in a quality index through Niantic's official v4 tools. */
export async function repackSpzV4(
  request: RepackSpzV4Request,
  io: RepackSpzV4Io,
): Promise<number> {
  const indexPath = resolve(request.indexPath);
  const inputDir = dirname(indexPath);
  const outputDir = resolve(request.outputDir);
  const outputIndexPath = join(outputDir, basename(indexPath));
  const spzToPly = join(resolve(request.spzToolsDir), "spz_to_ply");
  const plyToSpz = join(resolve(request.spzToolsDir), "ply_to_spz");
  const temporaryDir = await mkdtemp(join(tmpdir(), "gs-spz-v4-"));

  try {
    await Promise.all([access(spzToPly), access(plyToSpz)]);
    if (!request.force && (await exists(outputIndexPath))) {
      throw new Error(`Output index already exists: ${outputIndexPath}`);
    }
    const index = parseIndex(await readFile(indexPath, "utf8"));
    const converted = new Map<string, { byteSize: number; url: string }>();
    for (const frame of index.frames) {
      for (const level of frame.qualityLevels) {
        if (level.url === undefined || converted.has(level.url)) {
          continue;
        }
        const inputPath = resolveIndexedAsset(inputDir, level.url);
        const outputUrl = level.url.replace(/\\/g, "/");
        const outputPath = resolveIndexedAsset(outputDir, outputUrl);
        if (!request.force && (await exists(outputPath))) {
          throw new Error(`Output already exists: ${outputPath}`);
        }
        await mkdir(dirname(outputPath), { recursive: true });
        const temporaryPly = join(
          temporaryDir,
          `${converted.size}-${basename(outputUrl)}.ply`,
        );
        io.stdout(`SPZ v4: ${level.url}`);
        await execFileAsync(spzToPly, [inputPath, temporaryPly]);
        await execFileAsync(plyToSpz, [temporaryPly, outputPath]);
        await assertSpzV4(outputPath);
        converted.set(level.url, {
          byteSize: (await stat(outputPath)).size,
          url: outputUrl,
        });
      }
    }

    const outputIndex: QualityCutIndex = {
      ...index,
      frames: index.frames.map((frame) => ({
        ...frame,
        qualityLevels: frame.qualityLevels.map((level) => {
          const output = level.url === undefined ? undefined : converted.get(level.url);
          return output === undefined
            ? { ...level }
            : {
                ...level,
                byteSize: output.byteSize,
                codec: "spz-v4",
                url: output.url,
              };
        }),
      })),
    };
    await mkdir(outputDir, { recursive: true });
    await writeFile(outputIndexPath, `${JSON.stringify(outputIndex, null, 2)}\n`);
    io.stdout(`Wrote ${converted.size} SPZ v4 asset(s) and ${outputIndexPath}`);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await rm(temporaryDir, { force: true, recursive: true });
  }
}

function parseIndex(text: string): QualityCutIndex {
  const value = JSON.parse(text) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("format" in value) ||
    value.format !== "flat-spz-quality-cuts" ||
    !("frames" in value) ||
    !Array.isArray(value.frames) ||
    value.frames.some(
      (frame) =>
        typeof frame !== "object" ||
        frame === null ||
        !("qualityLevels" in frame) ||
        !Array.isArray(frame.qualityLevels),
    )
  ) {
    throw new Error("Input is not a supported flat SPZ quality-cuts index.");
  }
  return value as QualityCutIndex;
}

function resolveIndexedAsset(root: string, url: string): string {
  if (isAbsolute(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) {
    throw new Error(`Quality tier URL must be relative for repacking: ${url}`);
  }
  const path = resolve(root, url);
  if (relative(root, path).startsWith("..")) {
    throw new Error(`Quality tier URL escapes its index directory: ${url}`);
  }
  return path;
}

async function assertSpzV4(path: string): Promise<void> {
  const bytes = await readFile(path);
  if (
    bytes.length < 8 ||
    bytes.subarray(0, 4).toString("ascii") !== "NGSP" ||
    bytes.readUInt32LE(4) !== 4
  ) {
    throw new Error(`Official SPZ tools did not produce a v4 file: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
