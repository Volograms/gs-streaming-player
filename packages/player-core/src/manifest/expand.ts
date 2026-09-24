import type {
  GaussianQualityLevel,
  GaussianSequenceManifest,
  GaussianSequenceManifestDocument,
} from "./schema.js";
import type { ManifestValidationIssue } from "./validation.js";

/** Expand storage defaults before URL resolution and timeline/quality validation. */
export function expandManifest(
  document: GaussianSequenceManifestDocument,
  issues: ManifestValidationIssue[],
): GaussianSequenceManifest {
  if (document.version === "1.0") return document;

  return {
    ...document,
    dynamicSequences: document.dynamicSequences.map((sequence, sequenceIndex) => {
      const { codec, regularTiming, qualityDefaults, ...rest } = sequence;
      const defaults = new Map(
        qualityDefaults?.map((quality) => [quality.level, quality]),
      );
      return {
        ...rest,
        frames: sequence.frames.map((frame, framePosition) => {
          const path = `/dynamicSequences/${sequenceIndex}/frames/${framePosition}`;
          const frameCodec = frame.codec ?? codec;
          const qualityLevels = frame.qualityLevels?.map(
            (quality): GaussianQualityLevel => {
              const shared = defaults.get(quality.level);
              const qualityCodec = quality.codec ?? shared?.codec ?? frameCodec;
              return {
                ...shared,
                ...quality,
                ...(qualityCodec === undefined ? {} : { codec: qualityCodec }),
                ...(shared?.metadata === undefined && quality.metadata === undefined
                  ? {}
                  : { metadata: { ...shared?.metadata, ...quality.metadata } }),
              };
            },
          );
          if (regularTiming === true && frame.timestampSeconds !== undefined) {
            issues.push({
              code: "schema",
              path: `${path}/timestampSeconds`,
              message: "must be omitted when regularTiming is true",
            });
          } else if (regularTiming !== true && frame.timestampSeconds === undefined) {
            issues.push({
              code: "schema",
              path: `${path}/timestampSeconds`,
              message: "is required unless regularTiming is true",
            });
          }
          const url = frame.url ?? defaultFrameUrl(qualityLevels);
          if (url === undefined) {
            issues.push({
              code: "schema",
              path: `${path}/url`,
              message:
                "is required when the minimum playable (or first) quality level has no URL",
            });
          }
          return {
            ...frame,
            frameIndex: frame.frameIndex ?? framePosition,
            timestampSeconds:
              regularTiming === true
                ? framePosition / sequence.frameRate
                : (frame.timestampSeconds ?? NaN),
            url: url ?? "",
            ...(frameCodec === undefined ? {} : { codec: frameCodec }),
            ...(qualityLevels === undefined ? {} : { qualityLevels }),
          };
        }),
      };
    }),
  };
}

export function defaultFrameUrl(
  levels: readonly GaussianQualityLevel[] | undefined,
): string | undefined {
  return (
    levels?.find((quality) => quality.minimumPlayable === true)?.url ?? levels?.[0]?.url
  );
}
