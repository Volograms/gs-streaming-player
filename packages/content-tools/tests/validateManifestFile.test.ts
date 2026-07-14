import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateManifestFile } from "../src/node.js";

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

describe("validateManifestFile", () => {
  it("validates JSON content without requiring referenced assets", async () => {
    const result = await validateManifestFile(validManifestPath);

    expect(result.valid).toBe(true);
  });

  it("reports semantic errors with exact JSON Pointer paths", async () => {
    const result = await validateManifestFile(invalidManifestPath);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining([
          "/frameCount",
          "/dynamicSequences/0/frames/1/frameIndex",
          "/dynamicSequences/0/frames/1/timestampSeconds",
        ]),
      );
    }
  });

  it("checks referenced assets only when requested", async () => {
    const result = await validateManifestFile(validManifestPath, {
      checkAssets: true,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]).toMatchObject({
        code: "asset-missing",
      });
    }
  });
});
