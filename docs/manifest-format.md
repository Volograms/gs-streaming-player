# Gaussian Sequence Manifest Format

The manifest is the versioned content contract shared by the player, demo, and content
tools. Version `1.0` describes persistent static splats, one or more dynamic per-frame
splat sequences, optional meshes, and optional audio.

The canonical JSON Schema is
[`gaussian-sequence-manifest.schema.json`](../packages/player-core/schemas/gaussian-sequence-manifest.schema.json).
TypeScript types are inferred from the same in-memory schema and a unit test ensures the
committed JSON file cannot drift from it.

## Minimal example

```json
{
  "$schema": "./gaussian-sequence-manifest.schema.json",
  "version": "1.0",
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
      "frames": [
        { "frameIndex": 0, "timestampSeconds": 0, "url": "frames/00000.rad" },
        {
          "frameIndex": 1,
          "timestampSeconds": 0.033333,
          "url": "frames/00001.rad"
        },
        {
          "frameIndex": 2,
          "timestampSeconds": 0.066667,
          "url": "frames/00002.rad"
        }
      ]
    }
  ]
}
```

The repository's [JSON-only fixture](../test-data/manifests/minimal-valid.json) can be
validated without having its referenced `.RAD` or GLB assets available.

## Root fields

| Field              | Required | Description                                         |
| ------------------ | -------- | --------------------------------------------------- |
| `$schema`          | No       | Editor-facing location of the JSON Schema.          |
| `version`          | Yes      | Manifest contract version; currently exactly `1.0`. |
| `id`               | Yes      | Non-empty content identifier.                       |
| `durationSeconds`  | Yes      | Positive timeline duration.                         |
| `frameRate`        | Yes      | Positive nominal timeline frame rate.               |
| `frameCount`       | Yes      | Frame count of the longest dynamic sequence.        |
| `staticObjects`    | Yes      | Persistent `.RAD` objects; may be empty.            |
| `dynamicSequences` | Yes      | At least one dynamic sequence.                      |
| `meshObjects`      | No       | Persistent GLTF/GLB scene objects.                  |
| `audio`            | No       | Optional audio track and timeline offset.           |
| `metadata`         | No       | Application-defined JSON-compatible metadata.       |

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

## Dynamic frames

Each dynamic sequence declares its own `frameRate`, `frameCount`, and `frames`. Every
frame contains a zero-based `frameIndex`, a non-negative `timestampSeconds`, a non-empty
asset `url`, and optional byte size, metadata URL, quality information, and metadata.

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
non-negative integer `level` and may provide `byteSize`, `splatCount`,
`minimumPlayable`, and arbitrary metadata. Levels must be unique and ordered from lowest
to highest, and at most one may be marked `minimumPlayable`.

Quality metadata is advisory. Incomplete refinement never changes whether the manifest
itself is structurally valid.

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
