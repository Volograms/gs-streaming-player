import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.config.{js,mjs,ts}",
        "**/dist/**",
        "**/tests/**",
        "apps/demo/src/main.tsx",
      ],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
    },
    projects: ["packages/*", "apps/*"],
  },
});
