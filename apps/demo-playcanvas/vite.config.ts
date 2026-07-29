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
      "HTTPS is enabled but .cert/localhost-key.pem or .cert/localhost-cert.pem is missing. See the README for the mkcert command.",
    );
  }

  return {
    plugins: [react()],
    publicDir: "../demo/public",
    server: {
      host: env.VITE_HOST ?? "127.0.0.1",
      port: 4177,
      ...(httpsEnabled
        ? {
            https: {
              key: readFileSync(keyPath),
              cert: readFileSync(certificatePath),
            },
          }
        : {}),
    },
  };
});
