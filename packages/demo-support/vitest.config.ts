import { defineConfig } from "vitest/config";

import { workspaceResolve } from "../../vitest.shared.config";

export default defineConfig({
  resolve: workspaceResolve,
  test: {
    environment: "node",
    name: "demo-support",
  },
});
