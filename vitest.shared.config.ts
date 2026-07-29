import { fileURLToPath } from "node:url";

export const workspaceResolve = {
  alias: {
    "@6g-path/gaussian-codec": fileURLToPath(
      new URL("./packages/codec-core/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-codec-spz": fileURLToPath(
      new URL("./packages/codec-spz/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-content-tools": fileURLToPath(
      new URL("./packages/content-tools/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-demo-support": fileURLToPath(
      new URL("./packages/demo-support/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-player": fileURLToPath(
      new URL("./packages/player-core/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-renderer-babylon": fileURLToPath(
      new URL("./packages/renderer-babylon/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-renderer-playcanvas": fileURLToPath(
      new URL("./packages/renderer-playcanvas/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-renderer-spark": fileURLToPath(
      new URL("./packages/renderer-spark/src/index.ts", import.meta.url),
    ),
    "@6g-path/gaussian-telemetry-6g": fileURLToPath(
      new URL("./packages/telemetry-6g/src/index.ts", import.meta.url),
    ),
    "@6g-path/shared": fileURLToPath(
      new URL("./packages/shared/src/index.ts", import.meta.url),
    ),
  },
};
