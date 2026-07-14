import type {
  GaussianSequenceManifest,
  ManifestValidationIssueCode,
} from "@6g-path/gaussian-player";

export type ManifestFileIssueCode =
  ManifestValidationIssueCode | "asset-missing" | "asset-request" | "parse" | "read";

export interface ManifestFileIssue {
  code: ManifestFileIssueCode;
  message: string;
  path: string;
}

export type ManifestFileValidationResult =
  | {
      valid: true;
      manifest: GaussianSequenceManifest;
      issues: [];
    }
  | {
      valid: false;
      issues: ManifestFileIssue[];
      manifest?: GaussianSequenceManifest;
    };

export interface ValidateManifestFileOptions {
  checkAssets?: boolean;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}
