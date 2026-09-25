import { open, readFile, writeFile } from "node:fs/promises";

export interface PlyHeader {
  byteLength: number;
  format: "ascii" | "binary_little_endian";
  properties: readonly PlyProperty[];
  vertexCount: number;
}

export interface PlyProperty {
  name: string;
  type: string;
}

/** Coloured points, e.g. an SfM sparse cloud. Colours are 0-255. */
export interface PointCloud {
  colors: Uint8Array;
  count: number;
  positions: Float32Array;
}

const MAX_HEADER_BYTES = 64 * 1024;
const PROPERTY_SIZES: Record<string, number> = {
  char: 1,
  double: 8,
  float: 4,
  float32: 4,
  float64: 8,
  int: 4,
  int32: 4,
  short: 2,
  uchar: 1,
  uint: 4,
  uint8: 1,
  ushort: 2,
};

/** Reads only the header, so large checkpoints can be counted cheaply. */
export async function readPlyHeader(path: string): Promise<PlyHeader> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_HEADER_BYTES, 0);
    return parsePlyHeader(buffer.subarray(0, bytesRead), path);
  } finally {
    await handle.close();
  }
}

export function parsePlyHeader(bytes: Uint8Array, label: string): PlyHeader {
  const text = Buffer.from(bytes).toString("latin1");
  const end = text.indexOf("end_header\n");
  if (!text.startsWith("ply\n") || end < 0) {
    throw new Error(`Not a PLY file with a readable header: ${label}`);
  }
  let format: PlyHeader["format"] | undefined;
  let vertexCount: number | undefined;
  let inVertexElement = false;
  const properties: PlyProperty[] = [];
  for (const line of text.slice(0, end).split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") {
      if (parts[1] !== "ascii" && parts[1] !== "binary_little_endian") {
        throw new Error(`Unsupported PLY format '${parts[1]}' in ${label}.`);
      }
      format = parts[1];
    } else if (parts[0] === "element") {
      inVertexElement = parts[1] === "vertex";
      if (inVertexElement) vertexCount = Number(parts[2]);
      else if (vertexCount !== undefined) break;
    } else if (parts[0] === "property" && inVertexElement) {
      if (parts[1] === "list") {
        throw new Error(`List properties are not supported in ${label}.`);
      }
      properties.push({ name: parts[2] ?? "", type: parts[1] ?? "" });
    }
  }
  if (
    format === undefined ||
    vertexCount === undefined ||
    !Number.isInteger(vertexCount)
  ) {
    throw new Error(`PLY header in ${label} has no format or vertex count.`);
  }
  return { byteLength: end + "end_header\n".length, format, properties, vertexCount };
}

export async function readPointCloud(path: string): Promise<PointCloud> {
  const bytes = await readFile(path);
  const header = parsePlyHeader(bytes.subarray(0, MAX_HEADER_BYTES), path);
  const names = header.properties.map(({ name }) => name);
  const indices = ["x", "y", "z", "red", "green", "blue"].map((name) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`Point cloud ${path} has no '${name}' property.`);
    return index;
  });
  const rows = readRows(bytes.subarray(header.byteLength), header, path);
  const positions = new Float32Array(header.vertexCount * 3);
  const colors = new Uint8Array(header.vertexCount * 3);
  for (let point = 0; point < header.vertexCount; point += 1) {
    const row = rows(point);
    for (let axis = 0; axis < 3; axis += 1) {
      positions[point * 3 + axis] = row(indices[axis]!);
      colors[point * 3 + axis] = row(indices[axis + 3]!);
    }
  }
  return { colors, count: header.vertexCount, positions };
}

/** Writes a binary little-endian PLY whose vertex properties are all float32. */
export async function writeFloatPly(
  path: string,
  properties: readonly string[],
  values: Float32Array,
): Promise<void> {
  if (values.length % properties.length !== 0) {
    throw new Error("PLY values must fill whole vertices.");
  }
  const count = values.length / properties.length;
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${count}`,
    ...properties.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n");
  const body = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  await writeFile(path, Buffer.concat([Buffer.from(header, "latin1"), body]));
}

function readRows(
  body: Uint8Array,
  header: PlyHeader,
  label: string,
): (row: number) => (property: number) => number {
  if (header.format === "ascii") {
    const lines = Buffer.from(body).toString("latin1").split("\n");
    return (row) => {
      const values = (lines[row] ?? "").trim().split(/\s+/).map(Number);
      if (values.length < header.properties.length) {
        throw new Error(`PLY row ${row} in ${label} is truncated.`);
      }
      return (property) => values[property]!;
    };
  }
  const offsets: number[] = [];
  let stride = 0;
  for (const { type } of header.properties) {
    const size = PROPERTY_SIZES[type];
    if (size === undefined)
      throw new Error(`Unsupported PLY type '${type}' in ${label}.`);
    offsets.push(stride);
    stride += size;
  }
  if (body.byteLength < stride * header.vertexCount) {
    throw new Error(`PLY body in ${label} is truncated.`);
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return (row) => (property) => {
    const offset = row * stride + offsets[property]!;
    switch (header.properties[property]!.type) {
      case "float":
      case "float32":
        return view.getFloat32(offset, true);
      case "double":
      case "float64":
        return view.getFloat64(offset, true);
      case "uchar":
      case "uint8":
        return view.getUint8(offset);
      case "char":
        return view.getInt8(offset);
      case "short":
        return view.getInt16(offset, true);
      case "ushort":
        return view.getUint16(offset, true);
      case "int":
      case "int32":
        return view.getInt32(offset, true);
      default:
        return view.getUint32(offset, true);
    }
  };
}
