import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli/runCli.js";

import type { CliIo } from "../src/cli/runCli.js";

const validManifestPath = resolve(
  fileURLToPath(
    new URL("../../../test-data/manifests/minimal-valid.json", import.meta.url),
  ),
);
const invalidManifestPath = resolve(
  fileURLToPath(
    new URL("../../../test-data/manifests/invalid-timeline.json", import.meta.url),
  ),
);

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stderr: (message) => stderr.push(message),
    stdout: (message) => stdout.push(message),
  };
  return { io, stderr, stdout };
}

describe("gs-manifest CLI", () => {
  it("returns zero for a valid manifest", async () => {
    const output = createIo();
    const exitCode = await runCli(["validate", validManifestPath], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("3 frame(s)");
    expect(output.stderr).toEqual([]);
  });

  it("returns non-zero and prints exact paths for invalid content", async () => {
    const output = createIo();
    const exitCode = await runCli(["validate", invalidManifestPath], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr.join("\n")).toContain(
      "/dynamicSequences/0/frames/1/frameIndex",
    );
  });

  it("returns a usage error for unsupported arguments", async () => {
    const output = createIo();
    const exitCode = await runCli(["create"], output.io);

    expect(exitCode).toBe(2);
    expect(output.stderr.join("\n")).toContain("Usage:");
  });
});
