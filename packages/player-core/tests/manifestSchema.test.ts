import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import validManifest from "../../../test-data/manifests/minimal-valid.json";
import committedSchema from "../schemas/gaussian-sequence-manifest.schema.json";
import {
  GaussianSequenceManifestSchema,
  compactManifest,
  validateManifest,
} from "../src/index.js";

describe("GaussianSequenceManifestSchema", () => {
  it("keeps the committed JSON Schema in sync with the typed schema", () => {
    expect(committedSchema).toEqual(
      JSON.parse(JSON.stringify(GaussianSequenceManifestSchema)),
    );
  });

  it("accepts the JSON-only minimal manifest fixture", () => {
    expect(validateManifest(validManifest)).toEqual({
      valid: true,
      manifest: validManifest,
      issues: [],
    });
  });

  it("supports both document versions in the standalone JSON Schema", () => {
    const validate = new Ajv({ strict: true, strictTuples: false }).compile(
      committedSchema,
    );
    expect(validate(validManifest)).toBe(true);
    expect(validate(compactManifest(validManifest))).toBe(true);
    expect(validate({ ...validManifest, version: "2.0" })).toBe(false);
  });

  it("reports exact paths for structural errors", () => {
    const result = validateManifest({
      ...validManifest,
      dynamicSequences: [
        {
          ...validManifest.dynamicSequences[0],
          frames: [{ frameIndex: 0, timestampSeconds: 0 }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual({
        code: "schema",
        message: "must have required property 'url'",
        path: "/dynamicSequences/0/frames/0/url",
      });
    }
  });

  it("reports frame count, index, and timestamp consistency errors", () => {
    const result = validateManifest({
      ...validManifest,
      frameCount: 4,
      dynamicSequences: [
        {
          ...validManifest.dynamicSequences[0],
          frames: [
            validManifest.dynamicSequences[0]!.frames[0],
            {
              ...validManifest.dynamicSequences[0]!.frames[1],
              frameIndex: 4,
              timestampSeconds: 0,
            },
            validManifest.dynamicSequences[0]!.frames[2],
          ],
        },
      ],
    });

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
});
