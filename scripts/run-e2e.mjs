/* global URL, fetch, process, setTimeout */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const serverScript = fileURLToPath(new URL("./start-e2e-servers.mjs", import.meta.url));
const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const demoPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const showcasePort = process.env.PLAYWRIGHT_SHOWCASE_PORT ?? "4180";

const servers = spawn(process.execPath, [serverScript], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

try {
  await Promise.all([
    waitForUrl(`http://127.0.0.1:${demoPort}`),
    waitForUrl(`http://127.0.0.1:${showcasePort}`),
  ]);
  const tests = spawn(
    process.execPath,
    [playwrightCli, "test", ...process.argv.slice(2)],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVERS: "true" },
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve) => {
    tests.on("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  servers.kill();
}

async function waitForUrl(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
