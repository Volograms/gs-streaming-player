/* global URL, fetch, process, setTimeout */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteBin = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const demoPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const showcasePort = process.env.PLAYWRIGHT_SHOWCASE_PORT ?? "4180";
const children = new Set();

const showcase = startVite("apps/showcase", showcasePort, {
  VITE_DEFAULT_MANIFEST_URL: process.env.VITE_DEFAULT_MANIFEST_URL ?? "",
  VITE_HTTPS: "false",
});
await waitForUrl(`http://127.0.0.1:${showcasePort}`);
const demo = startVite("apps/demo", demoPort, {
  VITE_DYNAMIC_QUALITY_INDEX_URL: process.env.VITE_DYNAMIC_QUALITY_INDEX_URL ?? "",
  VITE_DYNAMIC_RAD_BASE_URL: process.env.VITE_DYNAMIC_RAD_BASE_URL ?? "",
  VITE_HTTPS: "false",
  VITE_STATIC_RAD_URL: process.env.VITE_STATIC_RAD_URL ?? "",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
for (const child of [showcase, demo]) {
  child.on("exit", (code, signal) => {
    if (children.has(child)) {
      shutdown(code ?? (signal === null ? 1 : 0));
    }
  });
}

await new Promise(() => undefined);

function startVite(relativeCwd, port, overrides) {
  const child = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", port],
    {
      cwd: fileURLToPath(new URL(`../${relativeCwd}/`, import.meta.url)),
      env: { ...process.env, ...overrides },
      stdio: "inherit",
    },
  );
  children.add(child);
  return child;
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

function shutdown(exitCode) {
  for (const child of children) {
    children.delete(child);
    child.kill();
  }
  process.exit(exitCode);
}
