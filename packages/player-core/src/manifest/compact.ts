import { defaultFrameUrl } from "./expand.js";
import {
  GAUSSIAN_SEQUENCE_MANIFEST_VERSION,
  GAUSSIAN_SEQUENCE_MANIFEST_SCHEMA_ID,
} from "./schema.js";
import { assertValidManifest } from "./validation.js";

import type {
  CompactDynamicGaussianSequence,
  CompactGaussianFrameSource,
  CompactGaussianSequenceManifest,
  DynamicGaussianSequence,
  GaussianQualityDefaults,
  GaussianQualityLevel,
} from "./schema.js";

export interface CompactManifestOptions {
  /** Omit to detect exact regular timing independently for each sequence. */
  regularTiming?: boolean;
}

/** Compact a validated manifest without approximating timings, sizes or detail ratios. */
export function compactManifest(
  value: unknown,
  options: CompactManifestOptions = {},
): CompactGaussianSequenceManifest {
  const manifest = assertValidManifest(value);
  const compact: CompactGaussianSequenceManifest = {
    ...manifest,
    ...(manifest.$schema === undefined
      ? {}
      : { $schema: GAUSSIAN_SEQUENCE_MANIFEST_SCHEMA_ID }),
    version: GAUSSIAN_SEQUENCE_MANIFEST_VERSION,
    dynamicSequences: manifest.dynamicSequences.map((sequence) =>
      compactSequence(sequence, options),
    ),
  };
  assertValidManifest(compact);
  return compact;
}

function compactSequence(
  sequence: DynamicGaussianSequence,
  options: CompactManifestOptions,
): CompactDynamicGaussianSequence {
  const hasRegularTiming = sequence.frames.every(
    (frame, index) => frame.timestampSeconds === index / sequence.frameRate,
  );
  if (options.regularTiming === true && !hasRegularTiming) {
    throw new Error(
      `Sequence '${sequence.id}' does not have exact regular timing at ${sequence.frameRate} FPS; retain explicit timestamps.`,
    );
  }
  const regularTiming = options.regularTiming ?? hasRegularTiming;
  const firstCodec = sequence.frames[0]?.codec;
  const codec = sequence.frames.every((frame) => frame.codec === firstCodec)
    ? firstCodec
    : undefined;
  const frames = sequence.frames.map((frame): CompactGaussianFrameSource => {
    const compact: CompactGaussianFrameSource = { ...frame };
    delete compact.frameIndex;
    if (regularTiming) delete compact.timestampSeconds;
    if (codec !== undefined) delete compact.codec;
    if (frame.url === defaultFrameUrl(frame.qualityLevels)) delete compact.url;
    if (frame.qualityLevels !== undefined) {
      compact.qualityLevels = frame.qualityLevels.map((quality) => {
        const result = { ...quality };
        if (quality.codec === frame.codec) delete result.codec;
        return result;
      });
    }
    return compact;
  });

  const groups = new Map<number, GaussianQualityLevel[]>();
  for (const frame of frames) {
    for (const quality of frame.qualityLevels ?? []) {
      const group = groups.get(quality.level) ?? [];
      group.push(quality);
      groups.set(quality.level, group);
    }
  }
  const qualityDefaults: GaussianQualityDefaults[] = [];
  for (const [level, levels] of groups) {
    if (levels.length < 2) continue;
    const shared = sharedQualityDefaults(level, levels);
    if (Object.keys(shared).length === 1) continue;
    qualityDefaults.push(shared);
    for (const quality of levels) {
      for (const field of ["codec", "detailLevel", "minimumPlayable"] as const) {
        if (shared[field] !== undefined) delete quality[field];
      }
      if (shared.metadata !== undefined && quality.metadata !== undefined) {
        quality.metadata = Object.fromEntries(
          Object.entries(quality.metadata).filter(
            ([key]) => !Object.hasOwn(shared.metadata!, key),
          ),
        );
        if (Object.keys(quality.metadata).length === 0) delete quality.metadata;
      }
    }
  }
  return {
    ...sequence,
    ...(codec === undefined ? {} : { codec }),
    regularTiming,
    ...(qualityDefaults.length === 0
      ? {}
      : { qualityDefaults: qualityDefaults.sort((a, b) => a.level - b.level) }),
    frames,
  };
}

function sharedQualityDefaults(
  level: number,
  levels: GaussianQualityLevel[],
): GaussianQualityDefaults {
  const first = levels[0]!;
  const shared: GaussianQualityDefaults = { level };
  if (
    first.codec !== undefined &&
    levels.every((quality) => quality.codec === first.codec)
  )
    shared.codec = first.codec;
  if (
    first.detailLevel !== undefined &&
    levels.every((quality) => quality.detailLevel === first.detailLevel)
  )
    shared.detailLevel = first.detailLevel;
  if (
    first.minimumPlayable !== undefined &&
    levels.every((quality) => quality.minimumPlayable === first.minimumPlayable)
  )
    shared.minimumPlayable = first.minimumPlayable;
  if (first.metadata !== undefined) {
    const metadata = Object.fromEntries(
      Object.entries(first.metadata).filter(([key, value]) =>
        levels.every(
          (quality) =>
            quality.metadata !== undefined &&
            Object.hasOwn(quality.metadata, key) &&
            JSON.stringify(quality.metadata[key]) === JSON.stringify(value),
        ),
      ),
    );
    if (Object.keys(metadata).length > 0) shared.metadata = metadata;
  }
  return shared;
}
