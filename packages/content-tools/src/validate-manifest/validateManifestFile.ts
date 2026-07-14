import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateManifest } from "@6g-path/gaussian-player";

import { validateReferencedAssets } from "./referencedAssets.js";

import type {
  ManifestFileValidationResult,
  ValidateManifestFileOptions,
} from "./types.js";
import type { GaussianSequenceManifest } from "@6g-path/gaussian-player";

export async function validateManifestFile(
  inputPath: string,
  options: ValidateManifestFileOptions = {},
): Promise<ManifestFileValidationResult> {
  const manifestPath = resolve(inputPath);
  let source: string;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (cause) {
    return {
      valid: false,
      issues: [
        {
          code: "read",
          message: `could not read ${manifestPath}: ${describeCause(cause)}`,
          path: "/",
        },
      ],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (cause) {
    return {
      valid: false,
      issues: [
        {
          code: "parse",
          message: `is not valid JSON: ${describeCause(cause)}`,
          path: "/",
        },
      ],
    };
  }

  const validation = validateManifest(value);
  if (!validation.valid) {
    return { valid: false, issues: validation.issues };
  }

  if (options.checkAssets !== true) {
    return { valid: true, manifest: validation.manifest, issues: [] };
  }

  const assetIssues = await validateReferencedAssets(
    validation.manifest,
    manifestPath,
    options,
  );
  return assetIssues.length === 0
    ? { valid: true, manifest: validation.manifest, issues: [] }
    : {
        valid: false,
        manifest: validation.manifest,
        issues: assetIssues,
      };
}

export function countManifestFrames(manifest: GaussianSequenceManifest): number {
  return manifest.dynamicSequences.reduce(
    (total, sequence) => total + sequence.frames.length,
    0,
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
