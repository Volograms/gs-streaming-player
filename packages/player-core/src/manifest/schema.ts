import Type from "typebox";

export const GAUSSIAN_SEQUENCE_MANIFEST_VERSION = "1.0" as const;

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const NonNegativeNumberSchema = Type.Number({ minimum: 0 });
const PositiveNumberSchema = Type.Number({ exclusiveMinimum: 0 });
const MetadataSchema = Type.Record(Type.String(), Type.Unknown());

export const Vector3Schema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    z: Type.Number(),
  },
  { additionalProperties: false },
);

export const QuaternionSchema = Type.Object(
  {
    w: Type.Number(),
    x: Type.Number(),
    y: Type.Number(),
    z: Type.Number(),
  },
  { additionalProperties: false },
);

export const TransformSchema = Type.Object(
  {
    position: Type.Optional(Vector3Schema),
    rotation: Type.Optional(QuaternionSchema),
    scale: Type.Optional(Vector3Schema),
    matrix: Type.Optional(
      Type.Tuple([
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
        Type.Number(),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const GaussianQualityLevelSchema = Type.Object(
  {
    level: NonNegativeIntegerSchema,
    byteSize: Type.Optional(NonNegativeIntegerSchema),
    splatCount: Type.Optional(NonNegativeIntegerSchema),
    minimumPlayable: Type.Optional(Type.Boolean()),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const StaticSceneObjectSchema = Type.Object(
  {
    id: NonEmptyStringSchema,
    url: NonEmptyStringSchema,
    transform: Type.Optional(TransformSchema),
    priority: Type.Optional(NonNegativeNumberSchema),
    byteSize: Type.Optional(NonNegativeIntegerSchema),
    qualityLevels: Type.Optional(Type.Array(GaussianQualityLevelSchema)),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const GaussianFrameSourceSchema = Type.Object(
  {
    frameIndex: NonNegativeIntegerSchema,
    timestampSeconds: NonNegativeNumberSchema,
    url: NonEmptyStringSchema,
    byteSize: Type.Optional(NonNegativeIntegerSchema),
    metadataUrl: Type.Optional(NonEmptyStringSchema),
    qualityLevels: Type.Optional(Type.Array(GaussianQualityLevelSchema)),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const DynamicGaussianSequenceSchema = Type.Object(
  {
    id: NonEmptyStringSchema,
    frameCount: Type.Integer({ minimum: 1 }),
    frameRate: PositiveNumberSchema,
    frames: Type.Array(GaussianFrameSourceSchema, { minItems: 1 }),
    transform: Type.Optional(TransformSchema),
    priority: Type.Optional(NonNegativeNumberSchema),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const MeshSceneObjectSchema = Type.Object(
  {
    id: NonEmptyStringSchema,
    url: NonEmptyStringSchema,
    transform: Type.Optional(TransformSchema),
    priority: Type.Optional(NonNegativeNumberSchema),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const MediaTrackSchema = Type.Object(
  {
    url: NonEmptyStringSchema,
    contentType: Type.Optional(NonEmptyStringSchema),
    offsetSeconds: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const GaussianSequenceManifestSchema = Type.Object(
  {
    $schema: Type.Optional(NonEmptyStringSchema),
    version: Type.Literal(GAUSSIAN_SEQUENCE_MANIFEST_VERSION),
    id: NonEmptyStringSchema,
    durationSeconds: PositiveNumberSchema,
    frameRate: PositiveNumberSchema,
    frameCount: Type.Integer({ minimum: 1 }),
    staticObjects: Type.Array(StaticSceneObjectSchema),
    dynamicSequences: Type.Array(DynamicGaussianSequenceSchema, { minItems: 1 }),
    meshObjects: Type.Optional(Type.Array(MeshSceneObjectSchema)),
    audio: Type.Optional(MediaTrackSchema),
    metadata: Type.Optional(MetadataSchema),
  },
  {
    $id: "https://6g-path.eu/schemas/gaussian-sequence-manifest-1.0.json",
    $schema: "http://json-schema.org/draft-07/schema#",
    additionalProperties: false,
    title: "Adaptive Gaussian Splat Sequence Manifest",
  },
);

export type GaussianQualityLevel = Type.Static<typeof GaussianQualityLevelSchema>;
export type GaussianFrameSource = Type.Static<typeof GaussianFrameSourceSchema>;
export type StaticSceneObject = Type.Static<typeof StaticSceneObjectSchema>;
export type DynamicGaussianSequence = Type.Static<typeof DynamicGaussianSequenceSchema>;
export type MeshSceneObject = Type.Static<typeof MeshSceneObjectSchema>;
export type MediaTrack = Type.Static<typeof MediaTrackSchema>;
export type GaussianSequenceManifest = Type.Static<
  typeof GaussianSequenceManifestSchema
>;
