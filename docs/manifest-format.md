# Gaussian Sequence Manifest Format

The manifest is the versioned content contract shared by the player, demo, and content
tools. Version `1.1` describes persistent static splats, one or more dynamic per-frame
splat sequences, optional meshes, and optional audio in one file. It adds sequence-wide
codec and quality defaults and optional regular timing to reduce repetition. Version
`1.0` files remain readable.

The canonical JSON Schema is
[`gaussian-sequence-manifest.schema.json`](../packages/player-core/schemas/gaussian-sequence-manifest.schema.json).
TypeScript document types are inferred from the same in-memory schema and a unit test
ensures the committed JSON file cannot drift from it. `GaussianSequenceManifestDocument`
describes stored JSON; `GaussianSequenceManifest` describes the expanded runtime result
returned by `validateManifest`, `assertValidManifest`, and `loadManifest`.

## Minimal example

```json
{
  "$schema": "./gaussian-sequence-manifest.schema.json",
  "version": "1.1",
  "id": "lesson-01",
  "durationSeconds": 0.1,
  "frameRate": 30,
  "frameCount": 3,
  "staticObjects": [{ "id": "room", "url": "splats/room.rad" }],
  "dynamicSequences": [
    {
      "id": "presenter",
      "frameRate": 30,
      "frameCount": 3,
      "regularTiming": true,
      "frames": [
        { "url": "frames/00000.rad" },
        { "url": "frames/00001.rad" },
        { "url": "frames/00002.rad" }
      ]
    }
  ]
}
```

The repository's [JSON-only fixture](../test-data/manifests/minimal-valid.json) can be
validated without having its referenced `.RAD` or GLB assets available.

## Root fields

| Field              | Required | Description                                       |
| ------------------ | -------- | ------------------------------------------------- |
| `$schema`          | No       | Editor-facing location of the JSON Schema.        |
| `version`          | Yes      | Manifest contract version: `1.1` or legacy `1.0`. |
| `id`               | Yes      | Non-empty content identifier.                     |
| `durationSeconds`  | Yes      | Positive timeline duration.                       |
| `frameRate`        | Yes      | Positive nominal timeline frame rate.             |
| `frameCount`       | Yes      | Frame count of the longest dynamic sequence.      |
| `staticObjects`    | Yes      | Persistent `.RAD` objects; may be empty.          |
| `dynamicSequences` | Yes      | At least one dynamic sequence.                    |
| `meshObjects`      | No       | Persistent GLTF/GLB scene objects.                |
| `audio`            | No       | Optional audio track and timeline offset.         |
| `metadata`         | No       | Application-defined JSON-compatible metadata.     |

Unknown properties are rejected so misspellings produce validation errors.

## Objects and transforms

Every static, dynamic, and mesh object has a scene-wide unique `id`, a URL where
applicable, an optional non-negative `priority`, and an optional transform. Transforms
support:

- `position`: `{ x, y, z }`;
- `rotation`: quaternion `{ w, x, y, z }`;
- `scale`: `{ x, y, z }`;
- `matrix`: exactly 16 numeric values.

The player uses the explicit Three.js world and transform conventions documented in
[`coordinate-system.md`](coordinate-system.md). The renderer performs no implicit axis
conversion. A dynamic sequence transform is shared by all its frames.

The canonical runtime manifest deliberately stores rotations as quaternions and scales
as XYZ vectors. The `gs-content build` recipe also accepts the author-friendly
`rotationDegrees: { x, y, z }` form and a scalar uniform `scale`, then normalises both
when it generates this manifest. Configure each static object and the dynamic sequence
independently; transforms do not need to match.

## Dynamic frames

Each dynamic sequence declares its own `frameRate`, `frameCount`, and `frames`. Version
`1.1` supports these storage shortcuts:

- `frameIndex` may be omitted; its value is the frame's zero-based array position. An
  explicit index must still match that position.
- `regularTiming: true` on a sequence requires timestamps to be omitted. The loader
  calculates each timestamp as `frameIndex / sequence.frameRate`, starting at zero.
  Fractional rates such as `29.97` are supported without rounding the derived values.
- When `regularTiming` is false or absent, every frame must have a non-negative
  `timestampSeconds`. This supports irregular intervals and nonzero first timestamps.
  Playback starts at timeline zero, holding frame 0 until the next frame's timestamp (or
  the sequence end for a single frame). The leading interval remains seekable and
  repeats when looping; audio retains its position on the full timeline.
- A frame's `url` may be omitted when its minimum playable quality level has a URL,
  falling back to the first quality level's URL. An explicit frame URL takes precedence.

Version `1.0` requires all three frame fields explicitly. In either version, the loaded
runtime manifest always contains explicit indices, timestamps, URLs, and expanded
quality levels. Playback presentation and buffering deadlines follow those timestamps;
`frameRate` remains the nominal rate used for quality and capacity estimates. Optional
frame byte size, metadata URL, and metadata remain available.

In addition to JSON Schema validation, the player enforces:

- contiguous frame indices beginning at zero;
- strictly increasing timestamps;
- timestamps no later than `durationSeconds`;
- declared sequence counts matching their frame arrays;
- root `frameCount` matching the longest sequence;
- unique object IDs across static objects, dynamic sequences, and meshes.

Validation issues use JSON Pointer paths such as
`/dynamicSequences/0/frames/2/timestampSeconds`.

## Quality metadata

Static objects and dynamic frames may provide ordered `qualityLevels`. A level has a
non-negative integer `level` and may provide `codec`, `byteSize`, `splatCount`,
`minimumPlayable`, and arbitrary metadata. Levels must be unique and ordered from lowest
to highest, and at most one may be marked `minimumPlayable`. A dynamic frame may also
declare a default `codec`; a selected level's codec takes precedence. Codec IDs are
non-empty strings registered by the application, with `spz-v4` currently identifying the
official renderer-neutral SPZ v4 decoder. Omitting it retains the legacy renderer-owned
loading path.

Quality metadata is advisory. Incomplete refinement never changes whether the manifest
itself is structurally valid.

### Shared defaults in 1.1

A sequence may declare `codec` and ordered `qualityDefaults`. Quality defaults match
per-frame `qualityLevels` by `level`, not array position. Each default may contain
`codec`, `detailLevel`, `minimumPlayable`, and `metadata`. URLs, actual byte sizes, and
splat counts remain per frame. Defaults do not add quality levels to a frame: its
`qualityLevels` array declares the representations actually available.

For example, this sequence stores tier descriptions once:

```json
{
  "id": "performer",
  "frameRate": 29.97,
  "frameCount": 2,
  "regularTiming": true,
  "codec": "sog-v2",
  "qualityDefaults": [
    {
      "level": 0,
      "minimumPlayable": true,
      "metadata": { "tier": "preview", "targetRatio": 0.1 }
    },
    {
      "level": 1,
      "detailLevel": 1,
      "metadata": { "tier": "full", "targetRatio": 1 }
    }
  ],
  "frames": [
    {
      "qualityLevels": [
        {
          "level": 0,
          "url": "dynamic/00001-preview.sog",
          "byteSize": 375766,
          "splatCount": 30680,
          "detailLevel": 0.10000130379796347
        },
        {
          "level": 1,
          "url": "dynamic/00001-full.sog",
          "byteSize": 3165843,
          "splatCount": 306796
        }
      ]
    },
    {
      "qualityLevels": [
        {
          "level": 0,
          "url": "dynamic/00002-preview.sog",
          "byteSize": 376000,
          "splatCount": 31000,
          "detailLevel": 0.1
        },
        {
          "level": 1,
          "url": "dynamic/00002-full.sog",
          "byteSize": 3180000,
          "splatCount": 310000
        }
      ]
    }
  ]
}
```

Per-frame quality fields override matching defaults, including explicit `false` values.
Metadata merges by key: a per-frame key replaces the entire corresponding default value;
nested objects are not recursively merged. Codec precedence is per-frame quality codec,
matching quality-default codec, frame codec, then sequence codec. An absent codec
retains the legacy renderer-owned path. Multiple minimum playable levels are rejected
after inheritance as well as in the defaults themselves.

The exporter preserves actual detail ratios; it does not replace a measured ratio with
the target ratio. Common metadata keys move into defaults while frame-specific metadata
and encoding provenance are retained. Loading expands the compact representation into
runtime objects, so storage savings do not imply an equivalent reduction in runtime
memory.

## URL resolution

When `loadManifest` receives a URL, every relative static, frame, frame-metadata, mesh,
and audio URL is resolved against the manifest URL. Parsed objects, `Blob`, and `File`
inputs retain relative URLs unless a `baseUrl` option is provided.

```ts
import { loadManifest } from "@6g-path/gaussian-player";

const controller = new AbortController();
const manifest = await loadManifest("/content/lesson.json", {
  signal: controller.signal,
});
```

Loading distinguishes network, JSON parse, manifest validation, and abort errors through
subclasses of `ManifestLoadError`.

## CLI validation

Validate structure and timeline consistency without reading content assets:

```bash
pnpm gs-manifest validate ./content/lesson.json
```

Optionally verify every referenced local file and remote HTTP URL:

```bash
pnpm gs-manifest validate ./content/lesson.json --check-assets
```

The command exits with `0` for valid content, `1` for content/read failures, and `2` for
invalid command usage. Asset checks are deliberately opt-in so manifests can be
developed and tested before representative `.RAD` files are available.

## Convert an existing manifest without encoding

```bash
pnpm gs-manifest convert-manifest ./content/manifest.json
```

This validates and converts either supported version, writes compact JSON to
`./content/manifest.v1.1.json`, and reports the byte reduction. The input and encoded
assets are unchanged; assets do not need to be present. Existing output is protected.

- `--output <path>` chooses the destination. Relative asset URLs are rebased when its
  directory changes; absolute and site-root URLs remain unchanged. The destination
  directory must already exist, and relative assets cannot be rebased across volumes.
- `--regular-timing true` requires every sequence to match `index / frameRate` exactly
  and fails before writing if one does not. `--regular-timing false` retains timestamps.
  When omitted, each sequence is detected independently; rounded timestamps, offsets,
  and irregular timing retain their original values.
- `--pretty` writes indented JSON for inspection. The default removes whitespace.
- `--force` permits replacing the destination, including in-place conversion with
  `--output` pointing to the input. Conversion and validation finish before replacement.

Programmatic conversion uses `compactManifest(value, { regularTiming: true })` from
`@6g-path/gaussian-player`; omit the options to auto-detect timing. It returns a
`CompactGaussianSequenceManifest` without mutating the input.
