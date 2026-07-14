import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@6g-path/gaussian-player": fileURLToPath(
        new URL("../player-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    name: "content-tools",
  },
});
