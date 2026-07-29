# Preparing a streaming dataset

The repository does not reconstruct 4DGS and contains no large datasets. Start with an
ordered, registered per-frame Gaussian sequence and optional static scene.

## 1. Reconstruct and register

Use an external reconstruction pipeline.
[Apple SHARP](https://github.com/apple/ml-sharp) is one example that produces per-image
3DGS PLY output. Its OpenCV coordinates are not silently converted by this player.
Temporal coherence, subject/background separation, registration, scale, origin, and
transform calibration belong to the dataset producer.

## 2. Generate dynamic tiers

Keep each registered dynamic frame as PLY or SPZ. The public authoring path uses
PlayCanvas SplatTransform's merge-based decimation to create complete, independent
quality tiers, then writes each tier as bundled SOG or SPZ v4. Use identical tier
definitions across the ordered frame set.

Streamed SOG is a different tool: its spatial hierarchy supports camera-dependent
streaming of a large persistent scene. It is used for static objects, not as the source
of temporal frame tiers.

## 3. Define the build

Create a small JSON build recipe with `version`, dataset `id`, `frameRate`, and
`dynamic.inputDir`. This is not the runtime manifest: the build discovers the source
frames and generates the complete canonical `manifest.json` in the output directory. Add
transforms, static sources, and audio when needed. Paths are resolved relative to the
recipe.

```json
{
  "version": 1,
  "id": "sample-performance",
  "frameRate": 30,
  "dynamic": {
    "id": "performer",
    "inputDir": "frames",
    "outputFormat": "sog",
    "tiers": { "preview": 0.1, "minimum": 0.25, "medium": 0.5, "full": 1 },
    "minimumPlayable": "minimum",
    "maxSh": 0
  },
  "staticObjects": [{ "id": "stage", "input": "static/stage.ply" }],
  "audio": { "input": "audio/performance.ogg", "offsetSeconds": 0 }
}
```

`inputDir` is scanned non-recursively for `.ply` and `.spz` files. Files are put in
natural filename order, so `frame2.ply` precedes `frame10.ply`. Keep only original frame
sources in that directory and use stable frame-number filenames. For a deliberately
irregular sequence, replace `inputDir` with an explicit `frames` array; specifying both
is an error.

The `tiers` and `minimumPlayable` fields above show the defaults and may be omitted.
Tier names are user-defined when custom ratios are useful, but `minimumPlayable` must
name one of them.

### Place and orient objects

Give the dynamic sequence and every static object its own transform in the build recipe.
The transform on `dynamic` applies to every frame, so it is the right place to scale the
performer, put their feet on the floor, or move them away from the scene origin.

```json
{
  "dynamic": {
    "id": "performer",
    "inputDir": "frames",
    "transform": {
      "position": { "x": 1.2, "y": 0, "z": -0.5 },
      "rotationDegrees": { "x": 180, "y": 0, "z": 0 },
      "scale": 0.75
    }
  },
  "staticObjects": [
    {
      "id": "stage",
      "input": "static/stage.ply",
      "transform": {
        "position": { "x": 0, "y": -1.1, "z": 0 },
        "rotationDegrees": { "x": 180, "y": 0, "z": 0 },
        "scale": 4
      }
    }
  ]
}
```

`position` uses world units. `rotationDegrees` is an XYZ Euler rotation matching
PlayCanvas and is converted to a quaternion in the generated manifest. `scale` may be a
single uniform number or an `{ x, y, z }` object. Advanced recipes may instead provide a
quaternion as `rotation: { w, x, y, z }`, or a 16-number `matrix`; a matrix takes
precedence when rendered. Do not provide both rotation forms.

These convenience forms belong to the input build recipe, whose `version` is `1`. They
are not valid in the generated runtime manifest, whose `version` is `"1.0"`:

| Transform        | Build recipe                                      | Runtime manifest                                 |
| ---------------- | ------------------------------------------------- | ------------------------------------------------ |
| 180° X rotation  | `"rotationDegrees": { "x": 180, "y": 0, "z": 0 }` | `"rotation": { "w": 0, "x": 1, "y": 0, "z": 0 }` |
| Uniform scale 4× | `"scale": 4`                                      | `"scale": { "x": 4, "y": 4, "z": 4 }`            |

For the common upside-down and mismatched-scale case, start by applying the same
180-degree X correction to both objects. Then increase the static scale (or reduce the
dynamic scale), adjust each Y position until the floor and feet agree, and finally tune
X/Z placement.

During rapid visual calibration, you may edit the corresponding `transform` blocks in
the generated `manifest.json` and reload the showcase; this does not regenerate any SOG
tiers. Runtime manifests use vector scale and quaternion rotation—for example, a
180-degree X rotation is `{ "w": 0, "x": 1, "y": 0, "z": 0 }`. Once calibrated, copy the
final values back into the build recipe so a future `gs-content build --force` does not
overwrite them. The source PLY/SPZ/SOG files are never modified by transforms.

### Parallel build tuning

Dynamic frames can be processed concurrently. Automatic mode is the default:

```json
{
  "dynamic": {
    "inputDir": "frames",
    "frameWorkers": 0
  },
  "sog": {
    "maxWorkers": 4
  }
}
```

`dynamic.frameWorkers` controls how many source frames are active at once. Zero chooses
a CPU-aware value, capped at four. `sog.maxWorkers` controls worker threads inside each
SOG encoder process, so peak encoding concurrency is approximately
`frameWorkers × maxWorkers`. Merge decimation itself benefits from multiple active
frames.

For a high-core-count workstation, start with `frameWorkers: 2` or `4`. Reduce it to `1`
if source frames are very large, temporary PLY traffic saturates the disk, memory
pressure rises, or concurrent SOG compression contends for the same GPU. Tiers within a
single frame remain sequential to bound peak memory and scratch-file usage. The
equivalent lower-level option is `--frame-workers <n>`.

Preview and run:

```bash
pnpm gs-content build dataset.json --output-dir dist/content --dry-run
pnpm gs-content build dataset.json --output-dir dist/content \
  --frame-workers 4 \
  --max-workers 2
```

Existing output is protected; pass `--force` only after checking the target. The build
stages output, generates merge-decimated dynamic tiers, exports static Streamed SOG,
copies audio, populates exact splat/byte metadata, generates and validates the canonical
manifest, and then promotes the result. It does not rewrite the input recipe with file
names. `outputFormat` defaults to `"sog"`; use `"spz"` to produce SPZ v4 tiers for an
experimental runtime path.

To generate tiers without building a complete dataset:

```bash
pnpm gs-content generate-tiers frame-0000.ply frame-0001.spz \
  --output-dir generated/dynamic \
  --format sog \
  --frame-workers 4 \
  --tiers preview=0.10,minimum=0.25,medium=0.50,full=1

pnpm gs-content generate-tiers frame-0000.ply \
  --output-dir generated/dynamic-spz \
  --format spz
```

The first tier at ratio `1` is a format conversion; smaller ratios are public
SplatTransform merge-decimation passes. Each generated tier is inspected again so
`quality-cuts.json` contains the actual splat count and file size. Existing lower-level
commands remain available from `pnpm gs-content help`.

### Legacy RAD datasets

`gs-content extract-rad-cuts` and its pinned Spark Rust helper remain in the repository
for existing quality-LoD RAD datasets and historical experiment reproduction. The normal
`generate-tiers` and `build` commands neither invoke nor compile that helper.

## 4. Host and verify

Upload the entire output layout without changing relative paths. Serve correct MIME
types, enable CORS, use HTTPS, and retain byte-identical assets referenced by the
manifest. Validate locally and run the opt-in real-asset browser test before release.

See the public [SplatTransform project](https://github.com/playcanvas/splat-transform)
and the
[Streamed SOG authoring guide](https://developer.playcanvas.com/user-manual/splat-transform/streamed-sog/).
