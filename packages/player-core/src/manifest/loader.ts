import { ManifestValidationError, assertValidManifest } from "./validation.js";

import type { GaussianSequenceManifest } from "./schema.js";
import type { ManifestValidationIssue } from "./validation.js";

export type ManifestSource = string | URL | Blob | object;

export interface ManifestLoadOptions {
  baseUrl?: string | URL;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export type ManifestLoadErrorCode = "aborted" | "network" | "parse" | "validation";

export class ManifestLoadError extends Error {
  readonly code: ManifestLoadErrorCode;

  constructor(code: ManifestLoadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManifestLoadError";
    this.code = code;
  }
}

export class ManifestNetworkError extends ManifestLoadError {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super("network", message, options);
    this.name = "ManifestNetworkError";
    this.status = status;
  }
}

export class ManifestParseError extends ManifestLoadError {
  constructor(message: string, options?: ErrorOptions) {
    super("parse", message, options);
    this.name = "ManifestParseError";
  }
}

export class ManifestLoadValidationError extends ManifestLoadError {
  readonly issues: readonly ManifestValidationIssue[];

  constructor(issues: readonly ManifestValidationIssue[], options?: ErrorOptions) {
    super(
      "validation",
      `Manifest validation failed with ${issues.length} issue(s).`,
      options,
    );
    this.name = "ManifestLoadValidationError";
    this.issues = issues;
  }
}

export class ManifestAbortError extends ManifestLoadError {
  constructor(options?: ErrorOptions) {
    super("aborted", "Manifest loading was aborted.", options);
    this.name = "ManifestAbortError";
  }
}

export async function loadManifest(
  source: ManifestSource,
  options: ManifestLoadOptions = {},
): Promise<GaussianSequenceManifest> {
  throwIfAborted(options.signal);

  if (typeof source === "string" || source instanceof URL) {
    const manifestUrl = resolveManifestUrl(source, options.baseUrl);
    const value = await loadJsonFromUrl(manifestUrl, options);
    return resolveManifestAssetUrls(validateLoadedValue(value), manifestUrl);
  }

  if (isBlob(source)) {
    const text = await readBlobText(source, options.signal);
    const value = parseJson(text, describeBlob(source));
    const manifest = validateLoadedValue(value);
    return options.baseUrl === undefined
      ? manifest
      : resolveManifestAssetUrls(manifest, options.baseUrl);
  }

  const manifest = validateLoadedValue(source);
  return options.baseUrl === undefined
    ? manifest
    : resolveManifestAssetUrls(manifest, options.baseUrl);
}

async function loadJsonFromUrl(
  url: URL,
  options: ManifestLoadOptions,
): Promise<unknown> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (fetchImplementation === undefined) {
    throw new ManifestNetworkError("No fetch implementation is available.");
  }

  let response: Response;
  try {
    response = await fetchImplementation(
      url,
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (cause) {
    if (isAbort(options.signal, cause)) {
      throw new ManifestAbortError({ cause });
    }
    throw new ManifestNetworkError(
      `Failed to load manifest from ${url.href}.`,
      undefined,
      {
        cause,
      },
    );
  }

  if (!response.ok) {
    throw new ManifestNetworkError(
      `Manifest request failed with HTTP ${response.status} ${response.statusText}.`,
      response.status,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    if (isAbort(options.signal, cause)) {
      throw new ManifestAbortError({ cause });
    }
    throw new ManifestNetworkError(
      `Failed to read manifest response from ${url.href}.`,
      undefined,
      {
        cause,
      },
    );
  }

  throwIfAborted(options.signal);
  return parseJson(text, url.href);
}

function parseJson(text: string, sourceDescription: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ManifestParseError(
      `Manifest from ${sourceDescription} is not valid JSON.`,
      { cause },
    );
  }
}

function validateLoadedValue(value: unknown): GaussianSequenceManifest {
  try {
    return assertValidManifest(value);
  } catch (cause) {
    if (cause instanceof ManifestValidationError) {
      throw new ManifestLoadValidationError(cause.issues, { cause });
    }
    throw cause;
  }
}

function resolveManifestUrl(
  source: string | URL,
  baseUrl: string | URL | undefined,
): URL {
  if (source instanceof URL) {
    return source;
  }

  try {
    return new URL(source, baseUrl ?? getDocumentBaseUrl());
  } catch (cause) {
    throw new ManifestNetworkError(
      `Manifest URL '${source}' is relative but no valid base URL is available.`,
      undefined,
      { cause },
    );
  }
}

function getDocumentBaseUrl(): string | undefined {
  return typeof globalThis.location === "undefined"
    ? undefined
    : globalThis.location.href;
}

function resolveManifestAssetUrls(
  manifest: GaussianSequenceManifest,
  baseUrl: string | URL,
): GaussianSequenceManifest {
  const resolve = (url: string) => new URL(url, baseUrl).href;

  return {
    ...manifest,
    staticObjects: manifest.staticObjects.map((object) => ({
      ...object,
      url: resolve(object.url),
      ...(object.qualityLevels === undefined
        ? {}
        : {
            qualityLevels: object.qualityLevels.map((quality) => ({
              ...quality,
              ...(quality.url === undefined ? {} : { url: resolve(quality.url) }),
            })),
          }),
    })),
    dynamicSequences: manifest.dynamicSequences.map((sequence) => ({
      ...sequence,
      frames: sequence.frames.map((frame) => ({
        ...frame,
        url: resolve(frame.url),
        ...(frame.qualityLevels === undefined
          ? {}
          : {
              qualityLevels: frame.qualityLevels.map((quality) => ({
                ...quality,
                ...(quality.url === undefined ? {} : { url: resolve(quality.url) }),
              })),
            }),
        ...(frame.metadataUrl === undefined
          ? {}
          : { metadataUrl: resolve(frame.metadataUrl) }),
      })),
    })),
    ...(manifest.meshObjects === undefined
      ? {}
      : {
          meshObjects: manifest.meshObjects.map((object) => ({
            ...object,
            url: resolve(object.url),
          })),
        }),
    ...(manifest.audio === undefined
      ? {}
      : { audio: { ...manifest.audio, url: resolve(manifest.audio.url) } }),
  };
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function describeBlob(blob: Blob): string {
  return "name" in blob && typeof blob.name === "string"
    ? `file '${blob.name}'`
    : "Blob";
}

async function readBlobText(
  blob: Blob,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (signal === undefined) {
    return blob.text();
  }

  return new Promise<string>((resolve, reject) => {
    const abort = () => reject(new ManifestAbortError());
    signal.addEventListener("abort", abort, { once: true });
    blob.text().then(
      (text) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          reject(new ManifestAbortError());
        } else {
          resolve(text);
        }
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ManifestAbortError({ cause: signal.reason });
  }
}

function isAbort(signal: AbortSignal | undefined, cause: unknown): boolean {
  return (
    signal?.aborted === true ||
    (cause instanceof DOMException && cause.name === "AbortError")
  );
}
