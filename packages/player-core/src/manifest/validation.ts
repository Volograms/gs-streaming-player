import Ajv from "ajv";

import { expandManifest } from "./expand.js";
import {
  CompactGaussianSequenceManifestSchema,
  LegacyGaussianSequenceManifestSchema,
} from "./schema.js";

import type {
  GaussianQualityLevel,
  GaussianSequenceManifest,
  GaussianSequenceManifestDocument,
} from "./schema.js";
import type { ErrorObject } from "ajv";

export type ManifestValidationIssueCode =
  | "schema"
  | "duplicate-id"
  | "frame-count"
  | "frame-index"
  | "quality-level"
  | "timestamp-order"
  | "timestamp-range";

export interface ManifestValidationIssue {
  code: ManifestValidationIssueCode;
  message: string;
  path: string;
}

export type ManifestValidationResult =
  | { valid: true; manifest: GaussianSequenceManifest; issues: [] }
  | { valid: false; issues: ManifestValidationIssue[] };

export class ManifestValidationError extends Error {
  readonly issues: readonly ManifestValidationIssue[];

  constructor(issues: readonly ManifestValidationIssue[]) {
    super(`Manifest validation failed with ${issues.length} issue(s).`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictTuples: false,
});
const validateLegacySchema = ajv.compile<GaussianSequenceManifestDocument>(
  LegacyGaussianSequenceManifestSchema,
);
const validateCompactSchema = ajv.compile<GaussianSequenceManifestDocument>(
  CompactGaussianSequenceManifestSchema,
);

export function validateManifest(value: unknown): ManifestValidationResult {
  const validateSchema =
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === "1.1"
      ? validateCompactSchema
      : validateLegacySchema;
  if (!validateSchema(value)) {
    return {
      valid: false,
      issues: (validateSchema.errors ?? []).map(toSchemaIssue),
    };
  }

  const issues: ManifestValidationIssue[] = [];
  if (value.version === "1.1") {
    for (const [index, sequence] of value.dynamicSequences.entries()) {
      validateQualityLevels(
        sequence.qualityDefaults,
        `/dynamicSequences/${index}/qualityDefaults`,
        issues,
      );
    }
  }
  const manifest = expandManifest(value, issues);
  if (issues.length === 0) issues.push(...validateManifestSemantics(manifest));
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, manifest, issues: [] };
}

export function assertValidManifest(value: unknown): GaussianSequenceManifest {
  const result = validateManifest(value);
  if (!result.valid) {
    throw new ManifestValidationError(result.issues);
  }

  return result.manifest;
}

function toSchemaIssue(error: ErrorObject): ManifestValidationIssue {
  const path = appendErrorProperty(error.instancePath, error);
  return {
    code: "schema",
    message: error.message ?? `must satisfy ${error.keyword}`,
    path: path === "" ? "/" : path,
  };
}

function appendErrorProperty(instancePath: string, error: ErrorObject): string {
  if (error.keyword === "required") {
    return appendPointer(
      instancePath,
      String((error.params as { missingProperty: string }).missingProperty),
    );
  }

  if (error.keyword === "additionalProperties") {
    return appendPointer(
      instancePath,
      String((error.params as { additionalProperty: string }).additionalProperty),
    );
  }

  return instancePath;
}

function appendPointer(pointer: string, token: string): string {
  const escaped = token.replaceAll("~", "~0").replaceAll("/", "~1");
  return `${pointer}/${escaped}`;
}

function validateManifestSemantics(
  manifest: GaussianSequenceManifest,
): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const expectedManifestFrameCount = Math.max(
    ...manifest.dynamicSequences.map((sequence) => sequence.frameCount),
  );

  if (manifest.frameCount !== expectedManifestFrameCount) {
    issues.push({
      code: "frame-count",
      message: `must equal the longest dynamic sequence (${expectedManifestFrameCount})`,
      path: "/frameCount",
    });
  }

  validateUniqueObjectIds(manifest, issues);

  for (const [sequenceIndex, sequence] of manifest.dynamicSequences.entries()) {
    const sequencePath = `/dynamicSequences/${sequenceIndex}`;

    if (sequence.frameCount !== sequence.frames.length) {
      issues.push({
        code: "frame-count",
        message: `declares ${sequence.frameCount} frames but contains ${sequence.frames.length}`,
        path: `${sequencePath}/frameCount`,
      });
    }

    let previousTimestamp = -1;
    for (const [framePosition, frame] of sequence.frames.entries()) {
      const framePath = `${sequencePath}/frames/${framePosition}`;

      if (frame.frameIndex !== framePosition) {
        issues.push({
          code: "frame-index",
          message: `must be ${framePosition} to keep frame indices contiguous`,
          path: `${framePath}/frameIndex`,
        });
      }

      if (frame.timestampSeconds <= previousTimestamp) {
        issues.push({
          code: "timestamp-order",
          message: "must be greater than the previous frame timestamp",
          path: `${framePath}/timestampSeconds`,
        });
      }

      if (
        !Number.isFinite(frame.timestampSeconds) ||
        frame.timestampSeconds > manifest.durationSeconds
      ) {
        issues.push({
          code: "timestamp-range",
          message: `must not exceed durationSeconds (${manifest.durationSeconds})`,
          path: `${framePath}/timestampSeconds`,
        });
      }

      validateQualityLevels(frame.qualityLevels, `${framePath}/qualityLevels`, issues);
      previousTimestamp = frame.timestampSeconds;
    }
  }

  for (const [objectIndex, object] of manifest.staticObjects.entries()) {
    validateQualityLevels(
      object.qualityLevels,
      `/staticObjects/${objectIndex}/qualityLevels`,
      issues,
    );
  }

  return issues;
}

function validateUniqueObjectIds(
  manifest: GaussianSequenceManifest,
  issues: ManifestValidationIssue[],
): void {
  const seenIds = new Set<string>();
  const groups = [
    ["staticObjects", manifest.staticObjects],
    ["dynamicSequences", manifest.dynamicSequences],
    ["meshObjects", manifest.meshObjects ?? []],
  ] as const;

  for (const [groupName, objects] of groups) {
    for (const [objectIndex, object] of objects.entries()) {
      if (seenIds.has(object.id)) {
        issues.push({
          code: "duplicate-id",
          message: `object id '${object.id}' must be unique across the scene`,
          path: `/${groupName}/${objectIndex}/id`,
        });
      }
      seenIds.add(object.id);
    }
  }
}

function validateQualityLevels(
  levels: readonly GaussianQualityLevel[] | undefined,
  path: string,
  issues: ManifestValidationIssue[],
): void {
  if (levels === undefined) {
    return;
  }

  let previousLevel = -1;
  let minimumPlayableCount = 0;
  for (const [index, quality] of levels.entries()) {
    if (quality.level <= previousLevel) {
      issues.push({
        code: "quality-level",
        message: "levels must be unique and ordered from lowest to highest",
        path: `${path}/${index}/level`,
      });
    }
    if (quality.minimumPlayable === true) {
      minimumPlayableCount += 1;
      if (minimumPlayableCount > 1) {
        issues.push({
          code: "quality-level",
          message: "only one quality level may be marked minimumPlayable",
          path: `${path}/${index}/minimumPlayable`,
        });
      }
    }
    previousLevel = quality.level;
  }
}
