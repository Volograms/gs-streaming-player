import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const certificateDirectory = fileURLToPath(new URL("../../.cert/", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const httpsEnabled = env.VITE_HTTPS === "true";
  const keyPath = `${certificateDirectory}localhost-key.pem`;
  const certificatePath = `${certificateDirectory}localhost-cert.pem`;
  if (httpsEnabled && (!existsSync(keyPath) || !existsSync(certificatePath))) {
    throw new Error(
      "HTTPS is enabled but the local mkcert certificate is missing. See docs/quest-webxr.md.",
    );
  }
  return {
    base: env.VITE_BASE_PATH || "./",
    plugins: [react()],
    resolve: {
      alias: {
        "@6g-path/gaussian-codec": fileURLToPath(
          new URL("../../packages/codec-core/src/index.ts", import.meta.url),
        ),
        "@6g-path/gaussian-player": fileURLToPath(
          new URL("../../packages/player-core/src/index.ts", import.meta.url),
        ),
        "@6g-path/gaussian-renderer-playcanvas": fileURLToPath(
          new URL("../../packages/renderer-playcanvas/src/index.ts", import.meta.url),
        ),
        "@6g-path/shared": fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    },
    server: {
      host: env.VITE_HOST ?? "127.0.0.1",
      port: 4180,
      ...(httpsEnabled
        ? {
            https: {
              cert: readFileSync(certificatePath),
              key: readFileSync(keyPath),
            },
          }
        : {}),
    },
  };
});
