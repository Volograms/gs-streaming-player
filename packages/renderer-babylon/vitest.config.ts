import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@6g-path/gaussian-codec-spz": fileURLToPath(
        new URL("../codec-spz/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    name: "renderer-babylon",
  },
});
